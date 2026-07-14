use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};

/// How long to keep gathering more output after the first chunk of a burst
/// before flushing it as one `on_data` call. Well under a frame (~16 ms), so
/// added latency is imperceptible, but enough to collapse a flood of tiny
/// reads (e.g. `yes`, build output) into far fewer IPC messages.
const BATCH_WINDOW: Duration = Duration::from_millis(4);
/// Hard cap on a coalesced batch, so a steady stream flushes promptly instead
/// of growing unbounded (and to keep each IPC payload a sane size).
const BATCH_MAX_BYTES: usize = 64 * 1024;

/// Drains PTY output chunks from `rx`, coalescing bursts into larger batches,
/// and hands each batch to `on_data`. Returns once the sender is dropped (pty
/// EOF), after flushing whatever remains. Order and bytes are preserved
/// exactly — batching only changes how output is grouped, never its content.
fn coalesce(rx: Receiver<Vec<u8>>, on_data: impl Fn(Vec<u8>)) {
    loop {
        // Block until a burst starts.
        let mut batch = match rx.recv() {
            Ok(chunk) => chunk,
            Err(_) => return, // sender dropped, nothing pending
        };
        // Keep appending while more arrives within the window, up to the cap.
        while batch.len() < BATCH_MAX_BYTES {
            match rx.recv_timeout(BATCH_WINDOW) {
                Ok(chunk) => batch.extend_from_slice(&chunk),
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => {
                    on_data(batch);
                    return;
                }
            }
        }
        on_data(batch);
    }
}

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    // Held to keep the process handle alive; only read by non-Windows kill().
    #[cfg_attr(windows, allow(dead_code))]
    child: Box<dyn Child + Send + Sync>,
    #[cfg_attr(not(windows), allow(dead_code))]
    pid: Option<u32>,
}

/// Owns every live pty, keyed by tab id. Cloneable handle around shared state
/// so reader threads can clean up after themselves.
#[derive(Clone, Default)]
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

impl PtyManager {
    /// Spawns `cmd` in a new pty. `on_data` runs on a dedicated reader thread
    /// for every output chunk; `on_exit` runs once after the pty reaches EOF
    /// (process exited or was killed).
    pub fn spawn(
        &self,
        tab_id: String,
        cmd: CommandBuilder,
        cols: u16,
        rows: u16,
        on_data: impl Fn(Vec<u8>) + Send + 'static,
        on_exit: impl FnOnce() + Send + 'static,
    ) -> Result<(), String> {
        let pair = native_pty_system()
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(err)?;
        let child = pair.slave.spawn_command(cmd).map_err(err)?;
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().map_err(err)?;
        let writer = pair.master.take_writer().map_err(err)?;
        let pid = child.process_id();

        self.sessions.lock().unwrap().insert(
            tab_id.clone(),
            PtySession { master: pair.master, writer, child, pid },
        );

        // Reader thread pushes raw chunks into a channel; a second thread
        // coalesces bursts before crossing the IPC boundary. Splitting the two
        // lets the blocking read run flat-out while batching happens off the
        // read path.
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        std::thread::spawn(move || {
            let mut buf = [0u8; 16384];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if tx.send(buf[..n].to_vec()).is_err() {
                            break; // coalescer gone
                        }
                    }
                }
            }
            // tx dropped here → coalescer sees Disconnected and finishes.
        });

        let sessions = Arc::clone(&self.sessions);
        std::thread::spawn(move || {
            coalesce(rx, on_data);
            sessions.lock().unwrap().remove(&tab_id);
            on_exit();
        });
        Ok(())
    }

    pub fn write(&self, tab_id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions.get_mut(tab_id).ok_or("no such pty")?;
        session.writer.write_all(data.as_bytes()).map_err(err)
    }

    pub fn resize(&self, tab_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions.get(tab_id).ok_or("no such pty")?;
        session
            .master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(err)
    }

    /// Kills the process (tree) behind a tab and drops the pty. Dropping the
    /// master closes the pty handles, so the reader thread hits EOF and fires
    /// `on_exit`.
    pub fn kill(&self, tab_id: &str) {
        let session = self.sessions.lock().unwrap().remove(tab_id);
        let Some(session) = session else { return };
        Self::kill_session(session);
        // session (incl. master) dropped, so the reader thread hits EOF
    }

    // ConPTY child.kill() doesn't reliably kill grandchildren (the actual
    // shell/claude process tree) — taskkill the whole tree instead.
    #[cfg(windows)]
    fn kill_session(session: PtySession) {
        let Some(pid) = session.pid else { return };
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }

    #[cfg(not(windows))]
    fn kill_session(mut session: PtySession) {
        let _ = session.child.kill();
    }

    pub fn kill_all(&self) {
        let tab_ids: Vec<String> = self.sessions.lock().unwrap().keys().cloned().collect();
        for tab_id in tab_ids {
            self.kill(&tab_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Runs `coalesce` over a set of pre-queued chunks (sent, then sender
    /// dropped) so batching is deterministic: buffered items are ready, so
    /// `recv_timeout` never actually waits. Returns the batches `on_data` saw.
    fn coalesce_queued(chunks: &[Vec<u8>]) -> Vec<Vec<u8>> {
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        for chunk in chunks {
            tx.send(chunk.clone()).unwrap();
        }
        drop(tx);
        let batches = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&batches);
        coalesce(rx, move |batch| sink.lock().unwrap().push(batch));
        Arc::try_unwrap(batches).unwrap().into_inner().unwrap()
    }

    #[test]
    fn coalesce_preserves_all_bytes_in_order() {
        let chunks: Vec<Vec<u8>> = (0..10u8).map(|i| vec![i; 16 * 1024]).collect();
        let batches = coalesce_queued(&chunks);

        let expected: Vec<u8> = chunks.concat();
        let got: Vec<u8> = batches.concat();
        assert_eq!(got, expected);
    }

    #[test]
    fn coalesce_merges_small_chunks_into_one_batch() {
        let chunks = vec![b"foo".to_vec(), b"bar".to_vec(), b"baz".to_vec()];
        let batches = coalesce_queued(&chunks);
        // All buffered and tiny, so they collapse into a single batch.
        assert_eq!(batches, vec![b"foobarbaz".to_vec()]);
    }

    #[test]
    fn coalesce_caps_batch_size() {
        // 10 chunks of 16 KiB = 160 KiB; each batch stops appending once it
        // reaches the 64 KiB cap, so no batch grows without bound.
        let chunks: Vec<Vec<u8>> = (0..10u8).map(|i| vec![i; 16 * 1024]).collect();
        let batches = coalesce_queued(&chunks);

        assert!(batches.len() > 1, "expected the cap to split into multiple batches");
        for batch in &batches {
            // A batch appends whole chunks, so it can overshoot by at most one.
            assert!(batch.len() <= BATCH_MAX_BYTES + 16 * 1024);
        }
    }

    #[test]
    fn coalesce_returns_immediately_on_empty_stream() {
        let batches = coalesce_queued(&[]);
        assert!(batches.is_empty());
    }
}

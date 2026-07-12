use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};

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

        let sessions = Arc::clone(&self.sessions);
        std::thread::spawn(move || {
            let mut buf = [0u8; 16384];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => on_data(buf[..n].to_vec()),
                }
            }
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

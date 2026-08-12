import { describe, expect, it } from 'vitest';
import { parentPath } from './utils';

describe('parentPath', () => {
  it('shows the two nearest ancestors with an ellipsis when there are more above', () => {
    expect(parentPath('C:\\Users\\Exorsky\\Desktop\\prog\\too-many-terminals')).toBe('… / Desktop / prog');
  });

  it('omits the ellipsis when exactly the shown levels are all there is', () => {
    expect(parentPath('C:\\prog\\too-many-terminals')).toBe('C: / prog');
  });

  it('shows a single ancestor without an ellipsis when only one exists', () => {
    expect(parentPath('C:\\too-many-terminals')).toBe('C:');
  });

  it('returns empty for a root-level folder with no ancestors', () => {
    expect(parentPath('/too-many-terminals')).toBe('');
  });

  it('handles forward-slash paths the same way', () => {
    expect(parentPath('/home/user/prog/too-many-terminals')).toBe('… / user / prog');
  });

  it('respects a custom level count', () => {
    expect(parentPath('C:\\Users\\Exorsky\\Desktop\\prog\\too-many-terminals', 1)).toBe('… / prog');
  });
});

(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CursorHelper = factory();
  }
})(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  /**
   * Generates arrow key escape sequence honoring term.modes.applicationCursorKeysMode.
   * In applicationCursorKeysMode: \x1bOA, \x1bOB, \x1bOC, \x1bOD
   * In normal cursor keys mode:   \x1b[A, \x1b[B, \x1b[C, \x1b[D
   *
   * @param {'up'|'down'|'left'|'right'} direction
   * @param {object} term - xterm instance
   * @returns {string} escape sequence
   */
  function getCursorKeySequence(direction, term) {
    const isAppMode = Boolean(term && term.modes && term.modes.applicationCursorKeysMode);
    const prefix = isAppMode ? '\x1bO' : '\x1b[';
    switch (direction) {
      case 'up':
        return prefix + 'A';
      case 'down':
        return prefix + 'B';
      case 'right':
        return prefix + 'C';
      case 'left':
        return prefix + 'D';
      default:
        return '';
    }
  }

  return {
    getCursorKeySequence
  };
});

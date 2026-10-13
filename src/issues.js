// -----------------------------------------------------------------------------
// Deduplicated problem logging. A failure that repeats (a device unplugged, a
// key not yet allowed, a read-only /data) writes one line when it starts and
// one when it is over, not one per attempt: the attempts in between go to the
// debug level (LOG_LEVEL=debug shows them).
// -----------------------------------------------------------------------------

export class IssueLog {
  /** @param {object} logger an SDK logger (debug/info/warn/error) */
  constructor(logger) {
    this.logger = logger;
    /** @type {Map<string, string>} problems going on: key -> kind */
    this.open = new Map();
  }

  /**
   * A failure, logged at `level` the first time (or when its kind changes),
   * at debug while it lasts.
   * @param {string} key what fails (a device address)
   * @param {string} kind which failure (unreachable, unauthorized…)
   * @returns {boolean} true when it is a new problem
   */
  fail(key, kind, message, level = 'warn') {
    if (this.open.get(key) === kind) {
      this.logger.debug(message);
      return false;
    }
    this.open.set(key, kind);
    this.logger[level](message);
    return true;
  }

  /**
   * A success: one info line if a problem was going on, nothing otherwise.
   * @returns {boolean} true when a problem is over
   */
  recover(key, message) {
    if (!this.open.delete(key)) {
      return false;
    }
    if (message) {
      this.logger.info(message);
    }
    return true;
  }

  /** @param {string} key */
  isFailing(key) {
    return this.open.has(key);
  }
}

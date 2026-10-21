export class SkillRigError extends Error {
  constructor(message, { code = 'ERR_SKILLRIG', exitCode = 1, cause, details } = {}) {
    super(message, { cause });
    this.name = 'SkillRigError';
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

export class UsageError extends SkillRigError {
  constructor(message) {
    super(message, { code: 'ERR_USAGE', exitCode: 2 });
    this.name = 'UsageError';
  }
}

export class SecurityError extends SkillRigError {
  constructor(message, details) {
    super(message, { code: 'ERR_SECURITY', exitCode: 3, details });
    this.name = 'SecurityError';
  }
}

export class IntegrityError extends SkillRigError {
  constructor(message, details) {
    super(message, { code: 'ERR_INTEGRITY', exitCode: 4, details });
    this.name = 'IntegrityError';
  }
}

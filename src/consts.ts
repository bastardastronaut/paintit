export const ITERATION_LENGTH = parseInt(
  process.env.ITERATION_LENGTH ?? (1 * 60).toString()
);
export const ITERATION_COUNT = parseInt(
  process.env.ITERATION_COUNT ?? (10).toString()
);
export const ITERATION_PAINT = parseInt(
  process.env.ITERATION_PAINT ?? (125).toString()
);
export const DEFAULT_PAINT = parseInt(
  process.env.DEFAULT_PAINT ?? (250).toString()
);
export const CONSENSUS_MULTIPLIER = parseInt(
  process.env.CONSENSUS_MULTIPLIER ?? (1).toString()
);

export const UNLOCKED_PAINT = parseInt(
  process.env.UNLOCKED_PAINT ?? (1000).toString()
);

export const PALETTE_SIZE = parseInt(
  process.env.PALETTE_SIZE ?? (12).toString()
);

export const RATE_LIMIT_READ = parseInt(
  process.env.RATE_LIMIT_READ ?? (250).toString()
);

export const RATE_LIMIT_MUTATE = parseInt(
  process.env.RATE_LIMIT_MUTATE ?? (50).toString()
);

export const RATE_LIMIT_CREATE = parseInt(
  process.env.RATE_LIMIT_CREATE ?? (5).toString()
);

export const DEFAULT_PAINT_EMAIL_VERIFIED = 2000;
export const DEFAULT_PAINT_VIP = 3000;
export const INVITATION_BONUS = 100;

export const APP_PATH = process.env.APP_PATH || `${__dirname}/..`;
export const FS_PATH = process.env.FILESYSTEM_PATH || `${APP_PATH}/drawings`;

export const WALLET =
  process.env.WALLET ||
  "0dd740f1f726433da7a8dedb77c44b20ba7144245c8f2e138e000453398c9f8d";

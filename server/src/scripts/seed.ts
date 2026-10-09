import { runSeedCli } from './seedData';

runSeedCli().catch((error) => {
  console.error(error);
  process.exit(1);
});
import { pathToFileURL } from 'node:url';
import { createBot } from './bot/bot.js';
import { config } from './config.js';
import { startMonthlyRecapScheduler } from './services/scheduler.js';

/** Start hanya kalau file ini dijalankan langsung, bukan di-import (memudahkan smoke test). */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const bot = createBot();

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => bot.stop());
  }

  await bot.start({
    onStart: (info) => {
      console.log(
        `@${info.username} siap (long polling). timezone=${config.timezone} ` +
          `whitelist=${config.allowedIds.size || 'off'} model=${config.model}`,
      );
      // Setelah bot siap, bukan saat import: smoke test tidak boleh punya cron jalan.
      startMonthlyRecapScheduler(bot);
    },
  });
}

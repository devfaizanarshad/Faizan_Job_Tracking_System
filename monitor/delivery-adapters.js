import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

export async function deliverLocalAlert(alert, reportsRoot) {
  const alertDir=path.join(reportsRoot,'alerts');
  await fs.mkdir(alertDir,{recursive:true});
  const outputPath=path.join(alertDir,`alert_${alert.alert_id}.md`);
  await fs.writeFile(outputPath,`# ${alert.priority} — ${alert.alert_type}\n\n${alert.rendered_content}\n`,'utf8');
  process.stdout.write(`\n${alert.rendered_content}\n\n`);
  return {terminal:true,markdown:true,outputPath};
}

export function externalChannelReadiness(env=process.env) {
  return {
    EMAIL: {
      enabled:/^true$/i.test(env.PHASE2C_EMAIL_ENABLED||''),
      required:['PHASE2C_SMTP_HOST','PHASE2C_SMTP_PORT','PHASE2C_SMTP_USER','PHASE2C_SMTP_PASSWORD','PHASE2C_EMAIL_TO'],
      missing:['PHASE2C_SMTP_HOST','PHASE2C_SMTP_PORT','PHASE2C_SMTP_USER','PHASE2C_SMTP_PASSWORD','PHASE2C_EMAIL_TO'].filter(k=>!env[k])
    },
    TELEGRAM: {
      enabled:/^true$/i.test(env.PHASE2C_TELEGRAM_ENABLED||''),
      required:['PHASE2C_TELEGRAM_BOT_TOKEN','PHASE2C_TELEGRAM_CHAT_ID'],
      missing:['PHASE2C_TELEGRAM_BOT_TOKEN','PHASE2C_TELEGRAM_CHAT_ID'].filter(k=>!env[k])
    },
    DESKTOP: {
      enabled:/^true$/i.test(env.PHASE2C_DESKTOP_ENABLED||''),
      required:[],missing:[]
    }
  };
}

// External sends intentionally remain disabled until the corresponding ENABLED
// variable is set and a dedicated sender is reviewed. This module defines the
// stable adapter boundary without inventing or persisting credentials.

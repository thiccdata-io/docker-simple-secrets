import { Response } from 'express';

export function renderAlert(res: Response, type: 'error' | 'success' | 'warning', message: string, statusCode?: number): void {
  const status = statusCode || (type === 'error' ? 500 : 200);
  res.app.render(`partials/alert_${type}`, { message }, (err: Error | null, html: string) => {
    if (err) {
      res.status(500).send(`<div class="alert alert-error">Failed to render alert: ${err.message}</div>`);
      return;
    }
    res.status(status).send(html);
  });
}

export async function renderAlertAsync(res: Response, type: 'error' | 'success' | 'warning', message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    res.app.render(`partials/alert_${type}`, { message }, (err: Error | null, html: string) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(html);
    });
  });
}

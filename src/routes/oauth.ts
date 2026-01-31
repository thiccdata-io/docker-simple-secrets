import { Router, Request, Response } from 'express';
import passport from 'passport';
import { isOAuth2Configured } from '../utils/auth';

const router = Router();

router.get('/auth/oauth2', (req: Request, res: Response, next: any) => {
  if (!isOAuth2Configured()) {
    return res.status(503).send(`
      <html>
        <head><title>OAuth2 Not Configured</title></head>
        <body style="font-family: sans-serif; padding: 2rem;">
          <h1>OAuth2 Not Configured</h1>
          <p>OAuth2 authentication is not yet configured. Please deploy your OAuth2 secrets first.</p>
          <a href="/" style="display: inline-block; margin-top: 1rem; padding: 0.5rem 1rem; background: #667eea; color: white; text-decoration: none; border-radius: 4px;">Back to Home</a>
        </body>
      </html>
    `);
  }
  passport.authenticate('oauth2')(req, res, next);
});

router.get('/auth/oauth2/callback', (req: Request, res: Response, next: any) => {
  if (!isOAuth2Configured()) {
    return res.redirect('/');
  }

  passport.authenticate('oauth2', (err: any, user: any, info: any) => {
    if (err) {
      console.error('OAuth2 authentication error:', err);
      console.error('Error details:', JSON.stringify(err, null, 2));
      return res.send(`
        <html>
          <head><title>OAuth2 Error</title></head>
          <body style="font-family: sans-serif; padding: 2rem;">
            <h1>OAuth2 Authentication Failed</h1>
            <p><strong>Error:</strong> ${err.message || 'Unknown error'}</p>
            <pre style="background: #f5f5f5; padding: 1rem; border-radius: 4px; overflow: auto;">${JSON.stringify(err, null, 2)}</pre>
            <a href="/" style="display: inline-block; margin-top: 1rem; padding: 0.5rem 1rem; background: #667eea; color: white; text-decoration: none; border-radius: 4px;">Back to Home</a>
          </body>
        </html>
      `);
    }
    if (!user) {
      console.error('OAuth2 authentication failed: no user returned');
      return res.redirect('/');
    }
    req.logIn(user, loginErr => {
      if (loginErr) {
        console.error('Login error:', loginErr);
        return res.redirect('/');
      }
      req.session.save(saveErr => {
        if (saveErr) {
          console.error('Session save error:', saveErr);
        }
        return res.redirect('/');
      });
    });
  })(req, res, next);
});

router.get('/auth/logout', (req: Request, res: Response) => {
  req.logout(() => {
    res.redirect('/');
  });
});

export default router;

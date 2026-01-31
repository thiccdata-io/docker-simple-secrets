import { Router, Request, Response } from 'express';
import passport from 'passport';
import { isOAuth2Configured } from '../utils/auth';

const router = Router();

router.get('/auth/oauth2', (req: Request, res: Response, next: any) => {
  if (!isOAuth2Configured()) {
    return res.status(503).render('oauth2_not_configured');
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
      return res.render('oauth2_error', { errorMessage: err.message || 'Unknown error', errorDetails: JSON.stringify(err, null, 2) });
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

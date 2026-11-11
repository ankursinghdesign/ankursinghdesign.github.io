# Portfolio

Live at https://ankursingh.design

- `npm run dev`: local preview
- `npm run build`: blurs and encrypts the screens, builds the site and runs the leak check. Run it after changing screens, then commit `public/` and `src/data/`.
- `git push`: the pre-push hook re-runs the leak check, then GitHub Actions builds and publishes the site.

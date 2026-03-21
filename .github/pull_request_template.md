## Issue reference

Closes #

## Summary

<!-- One or two sentences. What does this PR do and why? -->

## Changes

<!-- Specific list of what changed. Name files/areas touched. -->

-
-

## Security model

<!-- Explicitly state the auth/authorisation story for this change.
     Who can call new endpoints? What resource ownership checks are in place?
     If no security-relevant changes, write "No security surface changed." -->

## Testing

<!-- How was this verified? -->

- [ ] Tested locally (backend + frontend running against Docker stack)
- [ ] New API endpoints manually exercised with expected + edge-case inputs
- [ ] UI changes visually verified in browser

## Checklist

- [ ] Branch named `feature/NNN-short-description` or `fix/NNN-short-description`
- [ ] Backend: no raw string interpolation of user input into SQL
- [ ] Backend: new routes registered in `main.py` with correct auth dependency
- [ ] Frontend: no sensitive data written to `localStorage` beyond the JWT token
- [ ] `npm run lint` passes
- [ ] `npm run format:check` passes (or `npm run format` run and changes committed)
- [ ] CI checks pass

## Screenshots (if UI change)

<!-- Delete if not applicable -->

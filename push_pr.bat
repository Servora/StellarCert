git add .
git commit -m "Fix: Restrict job enqueue endpoints to admin and integrate real services"
git push -u origin fix/jobs-rbac
gh pr create --title "Fix: Restrict job enqueue endpoints to admin and integrate real services" --body "- Added RolesGuard and @Roles(Role.Admin) to POST /jobs/email and POST /jobs/pdf.
- Controllers now use JwtAuthGuard + RolesGuard to enforce admin-only access.
- Implemented EmailService and PdfService injection in JobsProcessor; processors now call these services instead of merely logging.
- Added unit tests covering authorization logic and service invocation.
- All changes are limited to the jobs module."

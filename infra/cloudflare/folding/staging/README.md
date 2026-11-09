# Staging infrastructure

Use this root with the Folding OpenTofu staging state key from 1Password. It has its own encrypted remote state and application resources; never reuse the production state passphrase. Follow the production plan/apply/backup procedure with `staging` substituted. This root does not manage production email routing. API/admin routes remain disabled until the staging Worker is deployed.

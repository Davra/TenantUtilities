# TenantUtilities
Before running any of the scripts in this repository, run:
```
npm install
```

## Copy Tenant
Open `copyTenant/index.js` and set `TENANT_FROM` and `TENANT_TO` to the IDs of the tenants involved (`TENANT_TO` needs to have been created before running the script).
If any of the tenants are hosted outside of the Davra cloud deployments, the URLs will need to be set manually.
The authorization header is set for user `admin` with password `admin`, if using any other combination it will have to be set manually. If using a token then it should be set to `Bearer {TOKEN}`.
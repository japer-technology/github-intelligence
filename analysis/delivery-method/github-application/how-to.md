# How to Set Up GitClaw as a GitHub Application

### Step-by-step instructions for registering, configuring, and deploying gitclaw as a GitHub App.

<p align="center">
  <picture>
    <img src="https://raw.githubusercontent.com/japer-technology/gitclaw/main/.GITCLAW/GITCLAW-LOGO.png" alt="GitClaw" width="500">
  </picture>
</p>

---

## Prerequisites

- Admin access to the `japer-technology` GitHub organization (or your own org/account)
- A serverless hosting platform account (Cloudflare Workers, Vercel, AWS Lambda, or similar)
- Node.js 20+ installed locally
- A clone of the [gitclaw repository](https://github.com/japer-technology/gitclaw)

---

## Part 1 — Register the GitHub App

### 1.1 Open the App Registration Page

Go to your organization's developer settings:

```
https://github.com/organizations/japer-technology/settings/apps/new
```

For a personal account, use:

```
https://github.com/settings/apps/new
```

### 1.2 Fill in Basic Information

| Field | Value |
|-------|-------|
| **GitHub App name** | `gitclaw` |
| **Description** | `AI agent that runs entirely through GitHub Issues and Actions. One-click install into any repository.` |
| **Homepage URL** | `https://github.com/japer-technology/gitclaw` |

### 1.3 Configure the Callback and Webhook URLs

| Field | Value |
|-------|-------|
| **Webhook URL** | `https://<your-backend-domain>/api/webhook` (the endpoint your backend will listen on) |
| **Webhook secret** | Generate a strong random secret (save it — you will need it for your backend) |

To generate a webhook secret:

```bash
openssl rand -hex 32
```

### 1.4 Set Repository Permissions

Under **Repository permissions**, configure the following:

| Permission | Access | Purpose |
|------------|--------|---------|
| **Contents** | Read & Write | Commit `.GITCLAW/` files and workflow definitions |
| **Pull requests** | Read & Write | Open bootstrap and update PRs |
| **Workflows** | Read & Write | Commit workflow YAML files to `.github/workflows/` |
| **Actions** | Read | Verify workflow execution status |
| **Metadata** | Read | Required by default for all GitHub Apps |
| **Secrets** | Write *(optional)* | Automatically configure LLM API key secrets |
| **Issues** | Read & Write *(optional)* | Create initial setup issue with instructions |

### 1.5 Subscribe to Webhook Events

Under **Subscribe to events**, check the following:

| Event | Purpose |
|-------|---------|
| **Installation** | Triggered when the app is installed — initiates repository setup |
| **Installation repositories** | Triggered when repos are added to or removed from an existing installation |
| **Push** *(optional)* | Monitor for manual changes to `.GITCLAW/` files |
| **Release** *(optional)* | Trigger updates when a new gitclaw version is released |

### 1.6 Set Installation Scope

Under **Where can this GitHub App be installed?**, choose:

- **Any account** — if you want anyone on GitHub to install it
- **Only on this account** — if you want to restrict it to your organization

### 1.7 Create the App

Click **Create GitHub App**. After creation, note the following values from the app's settings page — you will need them for your backend:

| Value | Where to Find It |
|-------|-------------------|
| **App ID** | Settings → General (shown at the top) |
| **Client ID** | Settings → General |
| **Webhook secret** | The secret you generated in step 1.3 |

### 1.8 Generate a Private Key

On the app's settings page, scroll to **Private keys** and click **Generate a private key**. A `.pem` file will be downloaded.

> ⚠️ **Store this file securely.** It is used to authenticate your app. Never commit it to source code.

---

## Part 2 — Set Up the Backend

The backend receives webhook events from GitHub and uses the API to bootstrap repositories. It can run on any serverless platform.

### 2.1 Create the Project

```bash
mkdir gitclaw-app-backend && cd gitclaw-app-backend
npm init -y
npm install @octokit/app @octokit/rest
```

### 2.2 Configure Environment Variables

Set the following environment variables on your hosting platform (or in a local `.env` file for development):

| Variable | Value |
|----------|-------|
| `APP_ID` | The App ID from step 1.7 |
| `PRIVATE_KEY` | The full contents of the `.pem` file from step 1.8 (with newlines preserved) |
| `WEBHOOK_SECRET` | The webhook secret from step 1.3 |

### 2.3 Implement the Webhook Handler

Create the webhook handler that listens for `installation` and `installation_repositories` events. The handler must:

1. **Verify the webhook signature** using the `X-Hub-Signature-256` header and your webhook secret.
2. **Parse the event payload** to determine which repositories were added.
3. **Authenticate as the installation** by generating a JWT from your private key, then exchanging it for an installation access token.
4. **Bootstrap each repository** (see Part 3).

Example structure (Node.js). In production, validate that all required environment variables are present before initializing the app:

```js
import { App } from "@octokit/app";

const appId = process.env.APP_ID;
const privateKey = process.env.PRIVATE_KEY;
const webhookSecret = process.env.WEBHOOK_SECRET;

if (!appId || !privateKey || !webhookSecret) {
  throw new Error("Missing required environment variables: APP_ID, PRIVATE_KEY, WEBHOOK_SECRET");
}

const app = new App({
  appId,
  privateKey,
  webhooks: { secret: webhookSecret },
});

app.webhooks.on("installation.created", async ({ payload }) => {
  const installationId = payload.installation.id;
  const octokit = await app.getInstallationOctokit(installationId);

  for (const repo of payload.repositories) {
    await bootstrapRepository(octokit, repo.full_name);
  }
});

app.webhooks.on("installation_repositories.added", async ({ payload }) => {
  const installationId = payload.installation.id;
  const octokit = await app.getInstallationOctokit(installationId);

  for (const repo of payload.repositories_added) {
    await bootstrapRepository(octokit, repo.full_name);
  }
});
```

### 2.4 Deploy the Backend

Deploy to your chosen platform. Ensure the public URL matches the **Webhook URL** you registered in step 1.3.

| Platform | Deployment Command |
|----------|--------------------|
| **Cloudflare Workers** | `npx wrangler deploy` |
| **Vercel** | `npx vercel --prod` |
| **AWS Lambda** | Deploy via SAM, CDK, or the AWS Console |

After deployment, update the Webhook URL in the app settings if necessary:

```
https://github.com/organizations/japer-technology/settings/apps/gitclaw
```

---

## Part 3 — Implement Repository Bootstrap

When the app receives an installation event, it must commit the `.GITCLAW/` folder into each selected repository and open a pull request. All operations use the GitHub REST API — no cloning required.

### 3.1 Get the Default Branch Reference

```
GET /repos/{owner}/{repo}/git/ref/heads/{default_branch}
```

```js
const { data: ref } = await octokit.rest.git.getRef({
  owner,
  repo,
  ref: `heads/${defaultBranch}`,
});
const baseSha = ref.object.sha;
```

### 3.2 Get the Base Commit and Tree

```js
const { data: baseCommit } = await octokit.rest.git.getCommit({
  owner,
  repo,
  commit_sha: baseSha,
});
const baseTreeSha = baseCommit.tree.sha;
```

### 3.3 Create Blobs for Each `.GITCLAW/` File

For every file in the `.GITCLAW/` folder (read from the gitclaw source repo or a bundled copy), create a blob:

```js
const { data: blob } = await octokit.rest.git.createBlob({
  owner,
  repo,
  content: fileContentBase64,
  encoding: "base64",
});
```

### 3.4 Create a Tree with All Blobs

```js
const { data: tree } = await octokit.rest.git.createTree({
  owner,
  repo,
  base_tree: baseTreeSha,
  tree: files.map((file) => ({
    path: file.path,       // e.g. ".GITCLAW/config.yml"
    mode: "100644",
    type: "blob",
    sha: file.blobSha,
  })),
});
```

### 3.5 Create the Install Commit

```js
const { data: commit } = await octokit.rest.git.createCommit({
  owner,
  repo,
  message: "feat: install gitclaw 🦞",
  tree: tree.sha,
  parents: [baseSha],
});
```

### 3.6 Create the Install Branch

```js
await octokit.rest.git.createRef({
  owner,
  repo,
  ref: "refs/heads/gitclaw/install",
  sha: commit.sha,
});
```

### 3.7 Open a Pull Request

```js
await octokit.rest.pulls.create({
  owner,
  repo,
  title: "🦞 Install GitClaw",
  head: "gitclaw/install",
  base: defaultBranch,
  body: `## 🦞 GitClaw Installation

This PR adds the \`.GITCLAW/\` folder and GitHub Actions workflows to enable GitClaw in this repository.

### What's included
- \`.GITCLAW/\` folder — agent configuration, lifecycle scripts, and skill packages
- \`.github/workflows/GITCLAW-WORKFLOW-AGENT.yml\` — the workflow that runs the agent

### After merging
1. Go to **Settings → Secrets and variables → Actions**
2. Add your LLM API key (e.g. \`ANTHROPIC_API_KEY\`)
3. Open an issue to start chatting with the agent

> Automatically created by the [gitclaw](https://github.com/japer-technology/gitclaw) GitHub App.`,
});
```

### 3.8 (Optional) Set the API Key Secret

If the app has `secrets: write` permission and the user provides an API key during a setup flow:

```js
// Requires the repository's public key for secret encryption
const { data: publicKey } = await octokit.rest.actions.getRepoPublicKey({
  owner,
  repo,
});

// Encrypt the secret value using libsodium
// See: https://docs.github.com/en/rest/actions/secrets#create-or-update-a-repository-secret
// Use the tweetsodium or libsodium-wrappers npm package for encryption:
//   import sodium from "libsodium-wrappers";
//   await sodium.ready;
//   const binkey = sodium.from_base64(publicKey.key, sodium.base64_variants.ORIGINAL);
//   const binsec = sodium.from_string(apiKeyValue);
//   const encrypted = sodium.crypto_box_seal(binsec, binkey);
//   const encryptedValue = sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);
const encryptedValue = encryptSecret(publicKey.key, apiKeyValue);

await octokit.rest.actions.createOrUpdateRepoSecret({
  owner,
  repo,
  secret_name: "ANTHROPIC_API_KEY",
  encrypted_value: encryptedValue,
  key_id: publicKey.key_id,
});
```

---

## Part 4 — Implement Automatic Updates

When a new gitclaw version is released, the app should update all installed repositories.

### 4.1 Detect New Versions

Choose one of these triggers:

- **Webhook on the gitclaw source repo** — subscribe to `release` events on `japer-technology/gitclaw`.
- **Cron job** — periodically check the latest release tag.
- **Manual trigger** — call an admin endpoint on your backend.

### 4.2 Update Each Installed Repository

For each installation, the backend:

1. Lists all repositories in the installation using `GET /installation/repositories`.
2. For each repository, reads the current `.GITCLAW/` version (e.g., from a version field in a config file).
3. If outdated, repeats the bootstrap process (Part 3) on a new branch (e.g., `gitclaw/update-v2.0.0`) and opens a PR with a changelog summary.

---

## Part 5 — Verify Webhook Signatures

Every incoming webhook request must be verified to confirm it originated from GitHub.

Verify the `X-Hub-Signature-256` header against the payload using your webhook secret:

```js
import { createHmac } from "crypto";

function verifySignature(payload, signature, secret) {
  const expected =
    "sha256=" +
    createHmac("sha256", secret).update(payload).digest("hex");
  return expected === signature;
}
```

> ⚠️ **Always reject requests with missing or invalid signatures.** This prevents unauthorized parties from triggering bootstrap operations.

If you use `@octokit/app`, signature verification is handled automatically when you configure the `webhooks.secret` option.

---

## Part 6 — Test the App

### 6.1 Test Locally with a Webhook Proxy

Use [smee.io](https://smee.io) to forward GitHub webhooks to your local machine during development:

```bash
npm install -g smee-client
smee --url https://smee.io/<your-channel> --path /api/webhook --port 3000
```

Set your app's Webhook URL to the smee.io URL while testing. Update it to the production URL before going live.

### 6.2 Install the App on a Test Repository

1. Go to `https://github.com/apps/gitclaw` (or your app's URL from step 1.7).
2. Click **Install**.
3. Select a test repository.
4. Confirm the installation.
5. Verify that the app creates a `gitclaw/install` branch and opens a PR with the `.GITCLAW/` folder.

### 6.3 Validate the PR Contents

The opened PR should contain:

- The full `.GITCLAW/` folder (agent config, lifecycle scripts, skills, etc.)
- `.github/workflows/GITCLAW-WORKFLOW-AGENT.yml`
- `.github/ISSUE_TEMPLATE/hatch.md` (optional, if included in bootstrap)
- A clear PR body with post-merge instructions

### 6.4 Merge and Verify End-to-End

1. Merge the PR.
2. Add an LLM API key secret (e.g., `ANTHROPIC_API_KEY`) to the test repo.
3. Open an issue — confirm the agent responds.

---

## Part 7 — Publish to GitHub Marketplace (Optional)

### 7.1 Prepare for Marketplace Listing

On the app's settings page, go to **Marketplace listing** and fill in:

| Field | Value |
|-------|-------|
| **Listing name** | `GitClaw` |
| **Short description** | `AI agent that runs through GitHub Issues. One-click install.` |
| **Full description** | Detailed explanation of gitclaw capabilities and how the app works |
| **Logo** | Upload the gitclaw logo |
| **Categories** | `Code quality`, `AI-assisted development`, or similar |
| **Pricing** | Free |

### 7.2 Submit for Review

Click **Submit for review**. GitHub reviews the app to ensure it meets Marketplace guidelines. This process may take several days.

### 7.3 After Approval

Once approved, the app appears at:

```
https://github.com/marketplace/gitclaw
```

Users can install it directly from the Marketplace page.

---

## Security Checklist

Before deploying to production, verify the following:

- [ ] **Private key** is stored in your platform's secret manager — never in source code or environment files committed to git
- [ ] **Webhook secret** is configured and signature verification is active
- [ ] **Installation access tokens** are used for all API calls (not the app JWT directly)
- [ ] **Minimal permissions** are requested — only the permissions listed in Part 1.4
- [ ] **Rate limits** are respected — batch operations stay within 5,000 requests/hour per installation
- [ ] **API key handling** (if using `secrets: write`) encrypts values with the repository's public key and never logs them

---

## Quick Reference

### App Authentication Flow

```
App Private Key → JWT → POST /app/installations/{id}/access_tokens → Installation Token → API Calls
```

The installation token expires after 1 hour. Request a new one before it expires.

### Key API Endpoints

| Operation | Endpoint |
|-----------|----------|
| Get installation token | `POST /app/installations/{installation_id}/access_tokens` |
| Get branch ref | `GET /repos/{owner}/{repo}/git/ref/heads/{branch}` |
| Create blob | `POST /repos/{owner}/{repo}/git/blobs` |
| Create tree | `POST /repos/{owner}/{repo}/git/trees` |
| Create commit | `POST /repos/{owner}/{repo}/git/commits` |
| Create branch | `POST /repos/{owner}/{repo}/git/refs` |
| Open PR | `POST /repos/{owner}/{repo}/pulls` |
| Set secret | `PUT /repos/{owner}/{repo}/actions/secrets/{secret_name}` |

### User Management URL

Users manage their installation at:

```
GitHub → Settings → Applications → gitclaw → Configure
```

From here they can add or remove repositories, suspend, or uninstall the app.

---

> 🦞 *One click to install. Zero files to copy. GitClaw as a service.*

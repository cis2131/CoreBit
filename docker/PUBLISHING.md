# Publishing Docker Image to GitHub Container Registry

This guide explains how to publish the CoreBit Docker image to GitHub Container Registry (ghcr.io).

## Automatic Publishing (Recommended)

The repository includes a GitHub Actions workflow that automatically builds and publishes the Docker image when:

1. You push changes to the `main` branch
2. You create a new release
3. You manually trigger the workflow

### Setup Steps

1. **Push the repository to GitHub**
   ```bash
   git remote add origin https://github.com/clausdk/corebit.git
   git push -u origin main
   ```

2. **Enable GitHub Actions**
   - Go to your repository on GitHub
   - Click "Actions" tab
   - Click "I understand my workflows, go ahead and enable them"

3. **Configure package visibility** (after first build)
   - Go to your GitHub profile → Packages
   - Find the `corebit` package
   - Click "Package settings"
   - Under "Danger Zone", change visibility to "Public" if desired

That's it! The workflow will automatically:
- Build the Docker image for AMD64 and ARM64
- Tag it with `latest`, version number, and git SHA
- Push to `ghcr.io/clausdk/corebit`

### Triggering a Build

**On push to main:** Automatic when you push code changes.

**Manual trigger:**
1. Go to Actions → "Build and Publish Docker Image"
2. Click "Run workflow"
3. Select the branch and click "Run workflow"

**On release:**
1. Go to Releases → "Create a new release"
2. Enter a tag (e.g., `v1.0.0`)
3. Publish the release
4. The workflow will automatically build and tag the image

---

## Manual Publishing

If you prefer to publish manually from your local machine:

### 1. Create a Personal Access Token (PAT)

1. Go to GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token (classic)"
3. Select scopes:
   - `read:packages`
   - `write:packages`
   - `delete:packages`
4. Copy the token

### 2. Login to GitHub Container Registry

```bash
# Replace YOUR_GITHUB_USERNAME and YOUR_PAT
echo YOUR_PAT | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

### 3. Build the Docker Image

```bash
# From the project root
docker build -f docker/Dockerfile -t ghcr.io/clausdk/corebit:latest .
```

### 4. Push to Registry

```bash
docker push ghcr.io/clausdk/corebit:latest
```

### 5. Tag with Version (Optional)

```bash
# Read version from version.json
VERSION=$(cat version.json | jq -r '.version')
BUILD=$(cat version.json | jq -r '.buildNumber')

# Tag and push
docker tag ghcr.io/clausdk/corebit:latest ghcr.io/clausdk/corebit:${VERSION}
docker tag ghcr.io/clausdk/corebit:latest ghcr.io/clausdk/corebit:${VERSION}-b${BUILD}

docker push ghcr.io/clausdk/corebit:${VERSION}
docker push ghcr.io/clausdk/corebit:${VERSION}-b${BUILD}
```

---

## Image Tags

The published image uses these tag patterns:

| Tag | Description | Example |
|-----|-------------|---------|
| `latest` | Most recent build from main | `ghcr.io/clausdk/corebit:latest` |
| `{version}` | Version number only | `ghcr.io/clausdk/corebit:1.0.0` |
| `{version}-b{build}` | Version with build number | `ghcr.io/clausdk/corebit:1.0.0-b95` |
| `sha-{hash}` | Git commit hash | `ghcr.io/clausdk/corebit:sha-abc1234` |

---

## Pulling the Image

Users can pull the image with:

```bash
# Latest version
docker pull ghcr.io/clausdk/corebit:latest

# Specific version
docker pull ghcr.io/clausdk/corebit:1.0.0
```

---

## Troubleshooting

### "denied: permission_denied" error

Make sure your PAT has `write:packages` scope.

### "unauthorized" error

Re-authenticate:
```bash
docker logout ghcr.io
echo YOUR_PAT | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

### Image not visible in GitHub

1. Go to your profile → Packages
2. The image appears after the first successful push
3. Make sure to set visibility to "Public" in package settings

### Actions workflow not running

1. Check if Actions are enabled in your repository settings
2. Verify the workflow file is in `.github/workflows/`
3. Check the "Actions" tab for any errors

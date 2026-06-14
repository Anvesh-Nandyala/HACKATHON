# CI/CD Setup

This project uses GitHub Actions for CI/CD.

## AWS Access

GitHub Actions uses AWS OIDC, so this repo does not need AWS access keys in GitHub Secrets.

Created AWS role:

`arn:aws:iam::861556843635:role/ReCircleGitHubActionsDeployRole`

The role trust policy allows only this repository on the `main` branch:

`repo:Anvesh-Nandyala/HACKATHON:ref:refs/heads/main`

Do not commit AWS access keys into this repo.

## Pipeline

On pull request to `main`:

1. Install backend dependencies.
2. Check backend JavaScript syntax.
3. Run backend tests.
4. Install frontend dependencies.
5. Build frontend.

On push to `main`:

1. Run all CI checks.
2. Deploy backend to Elastic Beanstalk.
3. Build frontend with the production backend URL.
4. Upload frontend build to S3.
5. Invalidate CloudFront cache.

## Workflow Constants

- `AWS_REGION`: `ap-south-2`
- `VITE_API_BASE`: `https://d3pcaip4rz2naa.cloudfront.net`
- `FRONTEND_BUCKET`: `circular-commerce-frontend-anvesh`
- `FRONTEND_CLOUDFRONT_DISTRIBUTION_ID`: `E39ZXFJXVW69R7`

## Live Services

Backend:

`circular-commerce-env`

Frontend bucket:

`circular-commerce-frontend-anvesh`

Frontend CloudFront:

`https://dlndvggys2r6k.cloudfront.net/#/`

Backend API CloudFront:

`https://d3pcaip4rz2naa.cloudfront.net`

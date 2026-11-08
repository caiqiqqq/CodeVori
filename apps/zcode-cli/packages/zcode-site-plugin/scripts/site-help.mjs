export const HELP = `zcode-site: deploy and manage CodeVori Sites. Run it from the project root.

Output
  stdout: JSON, one object per line. deploy prints progress events first; the last line is the result.
  stderr on failure: one line {"error":{"code","message","hint","data"?}}. Follow hint.

Exit codes
  0  success
  1  bad arguments, a local file or stage problem, or SITE_NOT_SELECTED
  2  not signed in to CodeVori, sign-in expired, or not run inside a CodeVori session
  3  quota, rate or size limit, or another deployment in progress
  4  the deployment failed, or a server error

Local command (no sign-in, nothing is uploaded)
  check <stage-dir> [--port <n>]
      Run "bash start.sh" in the stage with PORT (default 13000) and a temporary DATA_DIR, wait
      up to 90 s for GET / below 500, then stop it.
      Result: {status: "live", httpStatus, log} - the site should answer 200.
              {status: "skipped", reason} - the stage can't run on this machine (Linux binaries on
              macOS/Windows, or no bash); run the app from its normal local environment instead.
      START_FAILED: data {reason, httpStatus?, log}.

Site commands
  deploy <stage-dir> [--new | --site <id>] [--name <name>] [--prefix <prefix>]
         [--allow-foreign-binaries] [--quiet]
      Pack the stage directory (its root becomes /app) and publish it. Packing runs first and
      checks the package contract: root start.sh with LF line endings, size, file count, path
      depth, reserved /.__zcode/, broken symlinks, .env files, dependencies present, and every
      native binary linux x86-64. It skips .git, .DS_Store, __pycache__ and .codevori-site.json.
      PACKAGE_CHECK_FAILED (exit 1): data.problems lists everything to fix; nothing was created
      or uploaded. Fix all of them, then deploy again.
      --allow-foreign-binaries: accept non-linux binaries; only after confirming each listed file
                is never loaded at runtime (e.g. prebuilt binaries for other platforms next to
                the linux-x64 one).
      Target site: --site <id>, else the site in .codevori-site.json, else with --new a new site.
      A new site is linked by writing .codevori-site.json; keep it and don't put it in the stage.
      --new is ignored (with a warning) when the project is already linked.
      Without --new or --site on an unlinked project: SITE_NOT_SELECTED if the account has sites,
      data.candidates [{id, name, url, status}]; ask the user, never pick one yourself.
      --name    display name of a new site, any language (default: directory name). A name that
                fails the server's content review gets 3611 and nothing is created.
      --prefix  domain prefix of a new site: 4-30 chars, lowercase a-z 0-9 and -. The domain is
                {prefix}-{4 random chars}. The server lowercases it, turns other characters into
                -, cuts it to 30 and falls back to "site" below 4 or when the prefix fails content
                review; a warning event says so.
                Ignored for an existing site; the domain never changes.
      --quiet   print only the result.
      Events: {event: "packed", packageBytes, unpackedBytes, files, linuxBinaries}, then
              {event: "site_created" | "warning" | "deployment_started" | "uploading" | "log" | "status", ...}
      Result: {siteId, deploymentId, status: "success", url}
      Failure (exit 4): code is the failed stage reason, data has {siteId, deploymentId, failure}.
        PACKAGE_INVALID  server preflight rejected the package; message names the file.
        WARMUP_FAILED    GET / got no answer below 500 within 90 s; read logs, run check.
        UPLOAD_TIMEOUT   deploy again.
        PUBLISH_FAILED, PUBLISH_TIMEOUT, INTERNAL  platform side; retry later.
      The previous live version keeps serving after a failed deployment.
  status [--site <id>]
      Result: {id, name, url, status, offlineReason?, region, badgeHidden, badgeVisible, currentDeployment,
      latestDeployment} (deployments: {id, status, createdAt, finishedAt, failure}).
      status: pending = never deployed successfully, the URL shows nothing yet; online = the URL
              serves currentDeployment; offline = taken offline. offlineReason review_rejected means
              content review rejected the live version and took the site offline: online gets 3612,
              change the content and deploy again. A redeploy keeps the site online
              on the old version. Deployment progress is latestDeployment.status: preparing,
              uploading, publishing or verifying means still running (it ends within about 10
              minutes) - wait and check again, don't redeploy.
  logs <deploymentId> [--site <id>] [--offset <n>]
      Result: {entries: [{stage, level, message, ts}], nextOffset}; pass nextOffset to read on.
  offline [--site <id>]   take the site offline; domain and records are kept. Result: as status.
  online [--site <id>]    bring it back; a site never deployed successfully stays pending, and one whose
          live version was rejected by content review gets 3612. Result: as status.
  rename [--site <id>] <name>   change the display name only; 3611 if it fails content review.
          Result: as status.
  badge hide|show [--site <id>]   hide or show the "CodeVori" badge on the site. Only paid plans can
          hide it (usage.badgeRemovable); free plans get 3608. badgeHidden is the user's choice,
          badgeVisible whether the badge actually shows. Result: as status.
  list    Result: {sites: [{id, name, url, status}]}
  usage   Account traffic, requests and storage against the plan; canDeploy and exceededReasons.
  help    this text.

Commands without --site use the site in .codevori-site.json. Numeric error codes come from the Sites
API (e.g. 3605 quota exceeded, 3610 another deployment in progress); their hint says what to do.`;

// ---------- 入口 ----------

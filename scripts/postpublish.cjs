const { execSync } = require("node:child_process");
const { existsSync } = require("node:fs");

function sh(cmd) {
    execSync(cmd, { stdio: "inherit" });
}

// bump patch AFTER publish using carry-at-10 logic
sh("node ./scripts/bump-version.cjs");

// stage files
const files = ["package.json", "package-lock.json"];
const present = files.filter(existsSync);

if (present.length) sh(`git add ${present.join(" ")}`);
else sh("git add package.json");

// commit + push
sh('git commit -m "chore: post-publish bump" || true');
sh("git push");
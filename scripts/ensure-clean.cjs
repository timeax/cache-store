const {execSync} = require("node:child_process");
const readline = require("node:readline");

function sh(cmd) {
    return execSync(cmd, {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
}

function shInherit(cmd) {
    execSync(cmd, {stdio: "inherit"});
}

function getDirtyPorcelain() {
    return sh("git status --porcelain");
}

function askCommitMessage(prompt) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        rl.question(prompt, (ans) => {
            rl.close();
            resolve(String(ans || "").trim());
        });
    });
}

(async () => {
    const out = getDirtyPorcelain();

    // clean => continue
    if (!out) process.exit(0);

    console.log("Working tree is dirty. Changes:\n");
    console.log(out + "\n");

    // Allow non-interactive usage:
    // PUBLISH_COMMIT_MSG="chore: prep publish" npm publish
    let msg =
        (process.env.PUBLISH_COMMIT_MSG || "").trim() ||
        (process.env.COMMIT_MSG || "").trim();

    if (!msg && process.stdin.isTTY) {
        msg = await askCommitMessage(
            "Enter a commit message (blank = default 'chore: publish prep'): "
        );
    }

    if (!msg) msg = "chore: publish prep";

    // Stage everything (including untracked like scripts/)
    shInherit("git add -A");

    // Commit (if somehow nothing to commit, don't fail)
    shInherit(`git commit -m "${msg.replace(/"/g, '\\"')}" || true`);

    // Push (fail hard if push fails, to avoid publishing a commit you didn't push)
    try {
        shInherit("git push");
    } catch (e) {
        console.error(
            "\nPush failed. Fix your upstream/remote and re-run publish.\n" +
            "Tip: git push -u origin HEAD\n"
        );
        process.exit(1);
    }
})();
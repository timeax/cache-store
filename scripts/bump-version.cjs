const fs = require("node:fs");

function parseStrictSemver(v) {
    const m = String(v).trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (!m) throw new Error(`Version must be strict "x.y.z". Got: ${v}`);
    return {major: +m[1], minor: +m[2], patch: +m[3]};
}

function normalizeCarry10({major, minor, patch}) {
    // carry patch -> minor
    minor += Math.floor(patch / 10);
    patch = patch % 10;

    // carry minor -> major
    major += Math.floor(minor / 10);
    minor = minor % 10;

    return {major, minor, patch};
}

function bumpPatchCarry10(v) {
    let {major, minor, patch} = normalizeCarry10(v);

    patch += 1;
    if (patch >= 10) {
        patch = 0;
        minor += 1;
    }
    if (minor >= 10) {
        minor = 0;
        major += 1;
    }

    return {major, minor, patch};
}

function readJson(path) {
    return JSON.parse(fs.readFileSync(path, "utf8"));
}

function writeJson(path, obj) {
    fs.writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function replacePackageJsonVersion(path, nextVersion) {
    const raw = fs.readFileSync(path, "utf8");
    const out = raw.replace(
        /"version"\s*:\s*"[^"]*"/,
        `"version": "${nextVersion}"`
    );
    if (out === raw) throw new Error(`Failed to update version in ${path}`);
    fs.writeFileSync(path, out, "utf8");
}

const pkgPath = "package.json";
const pkg = readJson(pkgPath);

const cur = parseStrictSemver(pkg.version);
const next = bumpPatchCarry10(cur);
const nextStr = `${next.major}.${next.minor}.${next.patch}`;

// update package.json without reformatting the whole file
replacePackageJsonVersion(pkgPath, nextStr);

// update package-lock.json if present (minimal churn)
if (fs.existsSync("package-lock.json")) {
    const lock = readJson("package-lock.json");
    lock.version = nextStr;

    // npm v7+ format
    if (lock.packages && lock.packages[""]) {
        lock.packages[""].version = nextStr;
    }

    writeJson("package-lock.json", lock);
}

console.log(`Version bumped (carry-at-10): ${pkg.version} -> ${nextStr}`);
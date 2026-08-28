# Publishing `kept-core` and `@corgod/kept-cli`

Written down because it is performed rarely and from memory (design §22.4, R17.12). A publish is
irreversible per version, and the one thing worse than an unpublished package is a published broken
one. Do not automate it.

Both packages are `0.1.1`. `@corgod/kept-cli` depends on `kept-core` at `^0.1.1`, which resolves from the
public registry rather than only through the workspace symlink.

## Why the names are these names

Neither name was a preference, and both were forced by the registry. Recorded here because a
future reader will otherwise assume the asymmetry was a choice.

**`@kept/core` and `@kept/cli` were never obtainable.** The package `kept` already exists on npm at
`0.24.0` under another owner, and npm refuses to create an organisation whose name collides with an
existing package, so the `@kept` scope could not be registered by anyone. Both packages were renamed
to unscoped names.

**`kept-core` published. `kept-cli` was refused**, by npm's typosquatting filter, as too similar to
the existing `jest-cli`:

```
403 Forbidden - PUT https://registry.npmjs.org/kept-cli
Package name too similar to existing package jest-cli;
try renaming your package to '@corgod/kept-cli'
```

That is a permanent block on the name rather than a permissions problem, and it is not appealable.
A user scope is exempt from the similarity check because it is namespaced, which is why npm's own
error suggested this exact name and why the CLI is scoped while the library is not.

**The directory is still `packages/kept-cli`.** Only the published name is scoped. Three suites take
a directory argument and a mechanical rename briefly rewrote those too, which pointed
`resolve(REPO_ROOT, 'packages', dir)` at a path that does not exist; the two ideas are kept apart
deliberately.

**What a user types is unaffected.** The `bin` is `kept` in both spellings, so the commands are
`kept init`, `kept build`, `kept verify` however the package is named.

## The procedure, in order

### 1. Bump both versions together

`packages/kept-core/package.json` and `packages/kept-cli/package.json` carry the same `version`, and
`@corgod/kept-cli`'s `dependencies["kept-core"]` range must admit it. A CLI at `0.1.1` depending on
`^0.1.0` is a drift nobody notices until an install resolves the older core, so
`packages/kept-cli/test/packaging.test.ts` asserts the equality (R17.7) and asserts the range floor
matches the core version.

`packages/kept-cli/src/version.ts` holds `KEPT_VERSION` as a literal that mirrors the manifest. It is
a constant rather than a `package.json` import, so it is bumped in the same diff and reviewed
alongside. The committed snapshot's `generator.kept` field carries whatever it says.

### 2. Compile

```bash
npx tsc -b
```

`files: ["dist"]` means the archive's contents are decided by the build, not by the manifest, so a
stale `dist` publishes silently and the published code was never compiled from the committed source.
Both manifests declare `"prepublishOnly": "tsc -b"` (R17.8), so `npm publish` blocks on a failing
compile even if this step is skipped by hand. Run it anyway, because a green compile here is what
makes the next two steps meaningful.

Then the whole gate:

```bash
npm run check
```

### 3. Pack both, and inspect both file lists

```bash
npm pack --dry-run --json --workspace kept-core
npm pack --dry-run --json --workspace @corgod/kept-cli
```

`--dry-run` reports the file list without writing a tarball. What must be true (R17.4, R17.5):

- compiled output and `.d.ts` declarations present under `dist/`
- no `*.test.*`, no `test/fixtures/**`, no `*.evidence/**`, no `output-*/**`
- `dist/index.js` present in `@corgod/kept-cli`, and its first line is `#!/usr/bin/env node`

That last one is the failure that turns a global install into `Permission denied` on a machine that
is not the author's, and no other test in this repository would catch it: every other suite imports
the module rather than exec'ing the file.

`packages/kept-cli/test/packaging.test.ts` asserts all of the above and is the cheaper way to run
this step:

```bash
npx vitest run packages/kept-cli/test/packaging.test.ts
```

### 4. Measured sizes

Recorded so a publish that suddenly ships four megabytes is visible rather than discovered by an
installer. The packaging test fails above a four-megabyte packed ceiling and annotates the figure it
measured on every run, including green ones.

| package | entries | packed | unpacked |
| --- | --- | --- | --- |
| `kept-core-0.1.0.tgz` | 162 | 467.8 kB | 1765.7 kB |
| `@corgod/kept-cli-0.1.0.tgz` | 66 | 219.0 kB | 867.0 kB |

Both archives are `dist/` plus `README.md` plus `package.json`, and nothing else. npm adds the README
and the manifest regardless of `files`, which is why the package READMEs matter: they are the only
documentation an npm installer ever sees (R17.11).

Measured on Node 20.19.4 with npm 10.8.2. The `.js.map` and `.d.ts.map` files are roughly half of
each archive by entry count.

### 5. Run the outside-the-workspace install test

```bash
npx vitest run packages/kept-cli/test/install-outside-workspace.test.ts \
                packages/kept-cli/test/install-outside-workspace.prop.test.ts
```

`install-outside-workspace.test.ts` packs both packages, installs the tarballs into a temporary
directory under `os.tmpdir()` that is **not** under the workspace root and has no `node_modules` at
any level above it, and runs the installed binary from there with a `PATH` holding a single symlink
to `node`, so `kane-cli` is genuinely unreachable rather than assumed absent. It asserts the version
command reports the published version, that
`kept doctor` exits 0 in a directory with no config, no snapshot, no corpus and no Kane on the
`PATH`, that every check reports `not-configured`, that `kept init` is named as the remedy, and that
**no module resolves from this workspace** (R17.9, R17.10).

That last clause is the one that catches a hoisted dependency the workspace happened to provide.
Inside the workspace, Node's resolution walks up and finds everything, and the test passes while the
published package is broken. It is measured rather than inferred: a resolve hook records every
module URL the run resolves, and the assertion reads that list.

`install-outside-workspace.prop.test.ts` carries Property 35. Its generated half samples path shapes
across eight categories of artefact that must never be packed and checks them against both real file
lists; its exhaustive half asserts the archives, the manifests, the shebang and the one installation.

**Green, and it was red once, for a reason worth keeping in this document.** On its first real run
the install found a defect nothing else could see: `kept-core` imported `yaml`
(`dist/kane/failureYaml.js`) and `zod` (`dist/model/snapshot.js`) and declared neither in its
`dependencies`. Inside this workspace both resolve from the root `node_modules`, so every other
suite, the packaging test and `npm run check` were all green while an installer, having nothing above
the installation to resolve from, would have watched the binary die on its first import with
`ERR_MODULE_NOT_FOUND`. Both are declared now, `yaml` at `^2.9.0` and `zod` at `^4.4.3`, and the two
install suites went from ten failures to twenty-nine passing.

The finding stays written down because the shape of it is the argument of the whole repository: every
unit passed, the composition was wrong, and the thing hiding the fault was the workspace the tests
ran in. "It works when installed" was a claim with no test behind it, which is exactly the defect
this repository exists to detect, found this time in this repository.

Do not publish until these tests are green.

### 6. Publish core, then cli

Order matters. `@corgod/kept-cli` depends on `kept-core@^0.1.1`, so if the CLI is published first, there is
a window in which the dependency does not resolve for anyone who installs it.

```bash
npm publish --workspace kept-core --access public
npm publish --workspace @corgod/kept-cli  --access public
```

`--access public` because both are scoped packages and scoped packages default to restricted.

Then confirm the registry agrees:

```bash
npm view kept-core version
npm view @corgod/kept-cli version
npm view @corgod/kept-cli dependencies
```

### 7. Commit

```
chore(release): kept-core and @corgod/kept-cli 0.1.0
```

## If something is wrong after publishing

Do not unpublish and republish the same version; npm will not let you reuse it, and anyone who
already installed it keeps the broken bytes. Bump the patch version, fix, and walk this document
again from step 1. `npm deprecate` the bad version with a message naming the good one.

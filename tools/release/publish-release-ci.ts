// tslint:disable:no-console
import { green, red, yellow, bold, italic } from 'chalk';
import { execSync, ExecSyncOptions } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

import { BaseReleaseTask } from './base-release-task';
import { extractReleaseNotes } from './extract-release-notes';
import { GitClient } from './git/git-client';
import { getGithubNewReleaseUrl } from './git/github-urls';
import { notify, verifyNotificationPossibility } from './notify-release';
import { isNpmAuthenticated, npmLogout, npmLoginInteractive, npmPublish } from './npm/npm-client';
import { promptForNpmDistTag } from './prompt/npm-dist-tag-prompt';
import { promptForUpstreamRemote } from './prompt/upstream-remote-prompt';
import { checkReleasePackage } from './release-output/check-packages';
import { releasePackages } from './release-output/release-packages';
import { CHANGELOG_FILE_NAME } from './stage-release';
import { parseVersionName, Version } from './version-name/parse-version';


/** Maximum allowed tries to authenticate NPM. */
const MAX_NPM_LOGIN_TRIES = 2;

/**
 * Class that can be instantiated in order to create a new release. The tasks requires user
 * interaction/input through command line prompts.
 */
class PublishReleaseTask extends BaseReleaseTask {

    /** Path to the project package JSON. */
    packageJsonPath: string;

    /** Serialized package.json of the specified project. */
    packageJson: any;

    /** Parsed current version of the project. */
    currentVersion: Version;

    /** Path to the release output of the project. */
    releaseOutputPath: string;

    /** Instance of a wrapper that can execute Git commands. */
    git: GitClient;

    constructor(public projectDir: string,
                public repositoryOwner: string,
                public repositoryName: string) {
        super(new GitClient(projectDir,
            `https://github.com/${repositoryOwner}/${repositoryName}.git`));

        this.packageJsonPath = join(projectDir, 'package.json');
        this.releaseOutputPath = join(projectDir, 'dist');

        this.packageJson = JSON.parse(readFileSync(this.packageJsonPath, 'utf-8'));
        this.currentVersion = parseVersionName(this.packageJson.version);

        if (!this.currentVersion) {
            console.error(red(`Cannot parse current version in ${italic('package.json')}. Please ` +
                `make sure "${this.packageJson.version}" is a valid Semver version.`));
            process.exit(1);
        }
    }

    async run() {
        console.log();
        console.log(green('-----------------------------------------'));
        console.log(green(bold('  Mosaic release script')));
        console.log(green('-----------------------------------------'));
        console.log();

        const newVersionName = this.currentVersion.format();

        // Branch that will be used to build the output for the release of the current version.
        const publishBranch = this.git.getCurrentBranch();

        this.verifyLastCommitVersionBump();
        this.verifyLocalCommitsMatchUpstream(publishBranch);

        const npmDistTag = 'latest';

        this.buildReleasePackages();
        console.info(green(`  ✓   Built the release output.`));

        this.checkReleaseOutput();

        // Extract the release notes for the new version from the changelog file.
        const extractedReleaseNotes = extractReleaseNotes(
            join(this.projectDir, CHANGELOG_FILE_NAME), newVersionName);

        if (!extractedReleaseNotes) {
            console.error(red(`  ✘   Could not find release notes in the changelog.`));
            process.exit(1);
        }

        // Just in order to double-check that the user is sure to publish to NPM, we want
        // the user to interactively confirm that the script should continue.
        await this.promptConfirmReleasePublish();

        for (const packageName of releasePackages) {
            this.publishPackageToNpm(packageName, npmDistTag);
        }

        console.log();
        console.info(green(bold(`  ✓   Published all packages successfully`)));

        console.info(yellow(`  ⚠   Please draft a new release of the version on Github.`));

        notify(npmDistTag, newVersionName);
    }

    /**
     * Verifies that the latest commit on the current branch is a version bump from the
     * staging script.
     */
    private verifyLastCommitVersionBump() {
        if (!/chore: bump version/.test(this.git.getCommitTitle('HEAD'))) {
            console.error(red(`  ✘   The latest commit of the current branch does not seem to be a ` +
                `version bump.`));
            console.error(red(`      Please stage the release using the staging script.`));
            process.exit(1);
        }
    }

    /** Builds all release packages that should be published. */
    private buildReleasePackages() {
        const binDir = join(this.projectDir, 'node_modules/.bin');
        const spawnOptions: ExecSyncOptions = {cwd: binDir, stdio: 'inherit'};

        execSync('rm -rf dist', spawnOptions);
        execSync('yarn run build:cdk', spawnOptions);
        execSync('yarn run build:mosaic-moment-adapter', spawnOptions);
        execSync('yarn run build:mosaic', spawnOptions);
        execSync('yarn run styles:built-all', spawnOptions);
    }

    /** Checks the release output by running the release-output validations. */
    private checkReleaseOutput() {
        let hasFailed = false;

        releasePackages.forEach((packageName) => {
            if (!checkReleasePackage(this.releaseOutputPath, packageName)) {
                hasFailed = true;
            }
        });

        // In case any release validation did not pass, abort the publishing because
        // the issues need to be resolved before publishing.
        if (hasFailed) {
            console.error(red(`  ✘   Release output does not pass all release validations. Please fix ` +
                `all failures or reach out to the team.`));
            process.exit(1);
        }
    }

    /**
     * Prompts the user whether he is sure that the script should continue publishing
     * the release to NPM.
     */
    private async promptConfirmReleasePublish() {
        if (!await this.promptConfirm('Are you sure that you want to release now?')) {
            console.log();
            console.log(yellow('Aborting publish...'));
            process.exit(0);
        }
    }

    /**
     * Prompts the user whether he is sure that the script should continue publishing
     * the release to NPM.
     */
    private async promptPublishReleaseWithoutNotification() {
        if (!await this.promptConfirm(
            'File .env not found or invalid. Are you sure that you want to release without notification')) {
            console.log();
            console.log(yellow('Aborting publish...'));
            process.exit(0);
        }
    }

    /** Publishes the specified package within the given NPM dist tag. */
    private publishPackageToNpm(packageName: string, npmDistTag: string) {
        console.info(green(`  ⭮   Publishing "${packageName}"..`));

        const errorOutput = npmPublish(join(this.releaseOutputPath, packageName), npmDistTag);

        if (errorOutput) {
            console.error(red(`  ✘   An error occurred while publishing "${packageName}".`));
            console.error(red(`      Please check the terminal output and reach out to the team.`));
            console.error(red(`\n${errorOutput}`));
            process.exit(1);
        }

        console.info(green(`  ✓   Successfully published "${packageName}"`));
    }

    /**
     * Determines the name of the Git remote that is used for pushing changes
     * upstream to github.
     */
    private async getProjectUpstreamRemote() {
        const remoteName = this.git.hasRemote('upstream') ?
            'upstream' : await promptForUpstreamRemote(this.git.getAvailableRemotes());

        console.info(green(`  ✓   Using the "${remoteName}" remote for pushing changes upstream.`));

        return remoteName;
    }
}

/** Entry-point for the create release script. */
if (require.main === module) {
    new PublishReleaseTask(join(__dirname, '../../'), 'positive-js', 'mosaic').run();
}


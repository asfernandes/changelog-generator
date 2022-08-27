"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const github = require("@actions/github");
const core = require("@actions/core");
const request_1 = require("@octokit/request");
const token = core.getInput('token');
const fixVersionLabel = core.getInput('fix-version-label');
const repository = getRepository();
const headers = {
    authorization: `token ${token}`
};
function getRepository() {
    const repository = core.getInput("repository");
    if (repository) {
        const repositoryParts = repository.split("/");
        return {
            owner: repositoryParts[0],
            repo: repositoryParts[1],
        };
    }
    return github.context.repo;
}
async function getIssues(page) {
    const rawIssues = await (0, request_1.request)('GET /search/issues', {
        headers,
        page,
        per_page: 100,
        q: `repo:${repository.owner}/${repository.repo}+label:"${fixVersionLabel}"`
    });
    const issues = rawIssues.data.items.map(issue => {
        var _a, _b, _c;
        return ({
            number: issue.number,
            title: issue.title,
            state: issue.state,
            assignees: (_a = issue.assignees) === null || _a === void 0 ? void 0 : _a.map(({ login }) => login),
            link: issue.html_url,
            type: (_c = (_b = issue.labels) === null || _b === void 0 ? void 0 : _b.filter(({ name }) => name.startsWith('type: ')).map(({ name }) => name.substring(6))) === null || _c === void 0 ? void 0 : _c[0]
        });
    });
    return issues;
}
async function processIssues(issues) {
    const allAssignees = [...new Set(issues.flatMap(({ assignees }) => assignees).values())];
    const rawUsers = await Promise.all(allAssignees.map(login => (0, request_1.request)('GET /users/{username}', {
        headers,
        username: login
    })));
    const usersMap = new Map(rawUsers.map(user => [user.data.login, user.data.name]));
    const processedIssues = issues.map(issue => (Object.assign(Object.assign({}, issue), { assignees: issue.assignees.map(assignee => usersMap.get(assignee)) })));
    return processedIssues;
}
async function run() {
    let allIssues = [];
    let page = 1;
    while (true) {
        const issuesPage = await processIssues(await getIssues(page));
        if (!issuesPage.length)
            break;
        allIssues.push(...issuesPage);
        ++page;
    }
    const types = ['new feature', 'improvement', 'bug'];
    const issuesByType = types
        .map(type => [type, allIssues.filter(issue => issue.state == 'closed' && issue.type == type)])
        .filter(([, issues]) => issues.length);
    let outText = `\n# v${fixVersionLabel.substring(fixVersionLabel.indexOf(' ') + 1)}\n\n`;
    issuesByType.forEach(([type, issues]) => {
        const typeText = type == 'new feature' ? 'New features' :
            type == 'improvement' ? 'Improvements' :
                type == 'bug' ? 'Bugfixes' :
                    null;
        outText += `## ${typeText}\n\n`;
        issues.forEach(issue => {
            outText +=
                `* [#${issue.number}](${issue.link}): ${issue.title}  \n` +
                    `  Contributor(s): ${issue.assignees.join(', ')}\n\n`;
        });
    });
    core.notice(outText, { title: 'ChangeLog' });
    const warnings = allIssues
        .filter(({ state, type }) => state != 'closed' || !types.includes(type));
    if (warnings.length) {
        let outWarning = '\n';
        warnings.forEach(issue => outWarning +=
            `- #${issue.number} - ${issue.title}\n  ${issue.link}\n  Type: ${issue.type}\n  State: ${issue.state}\n\n`);
        core.warning(outWarning, { title: 'Warnings' });
    }
}
run();
//# sourceMappingURL=index.js.map
import * as github from "@actions/github";
import * as core from '@actions/core'
import { request } from '@octokit/request';


const token: string = core.getInput('token');
const fixVersionLabel: string = core.getInput('fix-version-label');
const repository = getRepository();

const headers = {
	authorization: `token ${token}`
};


function getRepository(): { owner: string, repo: string } {
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

async function getIssues(page: number) {
	const rawIssues = await request('GET /search/issues', {
		headers,
		page,
		per_page: 100,
		q: `repo:${repository.owner}/${repository.repo}+label:"${fixVersionLabel}"`
	});

	const issues = rawIssues.data.items.map(issue => ({
		number: issue.number,
		title: issue.title,
		state: issue.state,
		assignees: issue.assignees
			?.map(({ login }) => login),
		link: issue.html_url,
		type: issue.labels
			?.filter(({ name }) => name.startsWith('type: '))
			.map(({ name }) => name.substring(6))
			?.[0]
	}));

	return issues;
}

async function processIssues(issues: Awaited<ReturnType<typeof getIssues>>) {
	const allAssignees = [...new Set(issues.flatMap(({ assignees }) => assignees).values())];

	const rawUsers = await Promise.all(
		allAssignees.map(login =>
			request('GET /users/{username}', {
				headers,
				username: login
			})
		));

	const usersMap = new Map(rawUsers.map(user => [user.data.login, user.data.name]));

	const processedIssues = issues.map(issue => ({
		...issue,
		assignees: issue.assignees.map(assignee => usersMap.get(assignee))
	}))

	return processedIssues;
}

async function run() {
	let allIssues: Awaited<ReturnType<typeof getIssues>> = [];
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
		.map(type => [type, allIssues.filter(issue => issue.state == 'closed' && issue.type == type)] as const)
		.filter(([, issues]) => issues.length);

	let outMarkdownText = `\n# v${fixVersionLabel.substring(fixVersionLabel.indexOf(' ') + 1)}\n\n`;
	let outAsciiDocText = `\n`;

	issuesByType.forEach(([type, issues]) => {
		const typeText =
			type == 'new feature' ? 'New features' :
			type == 'improvement' ? 'Improvements' :
			type == 'bug' ? 'Bugfixes' :
			null;

		outMarkdownText += `## ${typeText}\n\n`;
		outAsciiDocText += `=== ${typeText}\n\n`;

		issues.forEach(issue => {
			outMarkdownText +=
				`* [#${issue.number}](${issue.link}): ${issue.title}  \n` +
				`  Contributor(s): ${issue.assignees.join(', ')}\n\n`;

			outAsciiDocText +=
				`_${issue.link}[#${issue.number}]_\n` +
				`-- ${issue.title}  \n\n` +
				`_Implemented by ${issue.assignees.join(', ')}_\n\n` +
				`'''\n\n`;
		});
	});

	core.notice(outMarkdownText, { title: 'ChangeLog in Markdown' });
	core.notice(outAsciiDocText, { title: 'ChangeLog in AsciiDoc' });

	const warnings = allIssues
		.filter(({ state, type }) => state != 'closed' || !types.includes(type));

	if (warnings.length) {
		let outWarning = '\n';

		warnings.forEach(issue => outWarning +=
			`- #${issue.number} - ${issue.title}\n  ${issue.link}\n  Type: ${issue.type}\n  State: ${issue.state}\n\n`
		);

		core.warning(outWarning, { title: 'Warnings' });
	}
}

run();

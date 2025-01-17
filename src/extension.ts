import * as vscode from 'vscode';
import axios from 'axios';
import { parseString } from 'xml2js';

interface Publication {
	title: string;
	authors: string[];
	year: string;
	booktitle: string;
	pages?: string;
	doi?: string;
	type?: string;
}

const PUBLICATION_DATABASE_KEY = 'bib-search.publicationDatabase';
const DBLP = 'DBLP';
const GOOGLE_SCHOLAR = 'Google Scholar';

async function fetchDBLPXML(query: string): Promise<Publication[]> {
	const url = `https://dblp.org/search/publ/api?q=${encodeURIComponent(query)}&format=xml`;
	try {
		const response = await axios.get(url);
		const xml = response.data;
		return new Promise((resolve, reject) => {
			parseString(xml, (err, result) => {
				if (err) {
					reject(err);
					return;
				}
				const hits = result.result?.hits?.[0]?.hit || [];
				const publications = hits.map((hit: any) => {
					const info = hit.info[0];
					return {
						title: info.title[0],
						authors: info.authors[0].author.map((a: any) => a._),
						year: info.year[0],
						booktitle: info.venue?.[0] || '',
						pages: info.pages?.[0],
						doi: info.doi?.[0],
						type: info.type?.[0]
					};
				});
				resolve(publications);
			});
		});
	} catch (error) {
		console.error('DBLP search error:', error);
		return [];
	}
}

async function generateBibTeX(pub: Publication): Promise<string> {
	const cleanAuthors = pub.authors.map(author => {
		return author.replace(/\s+\d+$/, '');
	});
	
	const authors = cleanAuthors.join(' and ');
	const firstAuthor = cleanAuthors[0].split(' ').pop()?.toLowerCase() || 'unknown';
	const citationKey = `${firstAuthor}${pub.year}`;
	
	let bib = `@article{${citationKey},\n`;
	bib += `  title = {${pub.title}},\n`;
	bib += `  author = {${authors}},\n`;
	bib += `  year = {${pub.year}},\n`;
	if (pub.booktitle) bib += `  journal = {${pub.booktitle}},\n`;
	if (pub.pages) bib += `  pages = {${pub.pages}},\n`;
	if (pub.doi) bib += `  doi = {${pub.doi}},\n`;
	bib += '}\n\n';
	return bib;
}

async function processPaperList() {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showErrorMessage('No active editor found');
		return;
	}

	const text = editor.document.getText();
	const papers = text.split('\n')
		.map(line => line.trim())
		.filter(line => line.length > 0)
		.map(line => line.replace(/^\d+\.\s*/, '').trim());

	if (papers.length === 0) {
		vscode.window.showErrorMessage('No papers found in editor');
		return;
	}

	const quickPick = vscode.window.createQuickPick();
	quickPick.canSelectMany = true;
	quickPick.items = papers.map((paper, index) => ({ 
		label: `${index + 1}. ${paper}`,
		description: `Paper ${index + 1}`,
		paper: paper // Store original paper title without number
	}));
	quickPick.title = 'Select papers to generate BibTeX entries';

	quickPick.show();

	quickPick.onDidAccept(async () => {
		const selectedPapers = quickPick.selectedItems;
		quickPick.dispose();

		if (selectedPapers.length === 0) {
			vscode.window.showInformationMessage('No papers selected');
			return;
		}

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Fetching citations...',
			cancellable: false
		}, async (progress) => {
			const bibEntries: string[] = [];
			const total = selectedPapers.length;

			for (let i = 0; i < selectedPapers.length; i++) {
				const paper = (selectedPapers[i] as any).paper; // Use the original paper title
				progress.report({
					message: `${i + 1}/${total}: ${paper}`,
					increment: 100 / total
				});

				const publications = await fetchDBLPXML(paper);
				if (publications.length > 0) {
					const bib = await generateBibTeX(publications[0]);
					bibEntries.push(bib);
				} else {
					bibEntries.push(`% Could not find citation for: ${paper}\n\n`);
				}
			}

			const doc = await vscode.workspace.openTextDocument({
				content: bibEntries.join(''),
				language: 'bibtex'
			});
			await vscode.window.showTextDocument(doc);
		});
	});
}

export function activate(context: vscode.ExtensionContext) {
	let processListDisposable = vscode.commands.registerCommand('autobib.processPaperList', processPaperList);
	context.subscriptions.push(processListDisposable);
}

export function deactivate() {}

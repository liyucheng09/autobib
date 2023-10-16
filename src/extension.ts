// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import axios from 'axios';
import cheerio, { Element, CheerioAPI } from 'cheerio';
import bibtexParser from 'bibtex-parser';
import { parse } from 'path';

interface Publication {
	title: string,
	authors: string[],
	year: string,
	booktitle: string,
	pages: string | undefined,
	doi: string | undefined,
}

/**
 * Fetches the HTML from Google Scholar Articles search page for the passed in search query.
 * @param query The search query to search Google Scholar for.
 * @returns Raw HTML from Google Scholar search page.
 */
async function fetchGoogleScholarHTML(query: string): Promise<string> {
	const url = `https://scholar.google.com/scholar?hl=en&as_sdt=0%2C5&q=${encodeURIComponent(query)}`;
	try {
		const response = await axios.get(url);
		return response.data;
	} catch (error: any) {
		throw new Error(`Error fetching Google Scholar HTML: ${error.message}`);
	}
}

async function parseGoogleScholarHTML(html: string) {
	const $ = cheerio.load(html);
	const publications: any[] = [];
	let promises: Promise<boolean>[] = [];
	// Modify the selector according to the structure of Google Scholar search results
	let searchResultNodes = $('.gs_r');
	searchResultNodes.each((_, element) => {
		const title = $(element).find('.gs_rt a').text();
		const authors = $(element).find('.gs_a').text().split("-")[0].split(",");
		const year = $(element).find('.gs_a').text().match(/\d{4}/)?.[0] || '';
		const booktitle = $(element).find('.gs_a').text().split("-")[1];
		const pages = '';
		const doi = $(element).find('.gs_ri a[href^="/scholar?oi=bibs&hl=en&cites="]').attr('href');
		const publication: Publication = {
			title: title,
			authors: authors,
			year: year,
			booktitle: booktitle,
			pages: pages,
			doi: doi,
		};
		publications.push(publication);
	});
	return publications;
}

/**
 * Searches Google Scholar for the passed in search query and returns a list of publications.
 * @param searchQuery The search query to search Google Scholar for.
 * @returns 
 */
let searchGoogleScholar = async (searchQuery: string): Promise<Publication[]> => {
	// Get the HTML from Google Scholar with the search query searchQuery
	const html = await fetchGoogleScholarHTML(searchQuery);
	const publications = await parseGoogleScholarHTML(html);
	return publications;
}

/**
 * Returns a list of quick pick options for the user to select from, based on the pased in search results.
 * @param searchResults The search results from Google Scholar.
 * @returns 
 */
let createQuickPickOptions = (searchResults: Publication[]): string[] => {
	return searchResults.map((publication) => {
		let quickPickOption = `${publication.title} ${publication.authors.join(", ")} (${publication.year})`;
		return quickPickOption;
	});
}

/**
 * Handles the search query from the user and inserts the selected BibTeX entry into the active editor.
 * @param searchQuery The raw search query from the user
 */
let searchQueryHandler = async (searchQuery: string): Promise<void> => {
	let searchResults = await searchGoogleScholar(searchQuery);
	let quickPickOptions = createQuickPickOptions(searchResults);
	const selections: string[] | undefined = await vscode.window.showQuickPick(quickPickOptions, { placeHolder: "Select a publication", canPickMany: true });
	if (selections === undefined || selections.length === 0) {
		return;
	}

	for (let selection of selections) {
		const publication = searchResults[quickPickOptions.indexOf(selection)];
		vscode.window.showInformationMessage(`Processing ${publication}.`);
		const bibtex = `@inproceedings{${publication.authors[0].replace(" ", "_").toLowerCase()}${publication.year},
	title={${publication.title}},
	author={${publication.authors.join(" and ")}},
	year={${publication.year}},
	booktitle={${publication.booktitle}},
}\n`;
		await vscode.window.activeTextEditor?.insertSnippet(new vscode.SnippetString(bibtex));
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "google-scholar-bibtex" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('google-scholar-bibtex.search', async () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		let searchQuery = await vscode.window.showInputBox({ title: "Google Scholar BibTeX: Search", placeHolder: "keywords" });
		if (searchQuery !== undefined && searchQuery !== "") {
			await searchQueryHandler(searchQuery);
		}
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() { }

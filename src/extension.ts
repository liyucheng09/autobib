// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import axios from 'axios';
import * as cheerio from 'cheerio';
import bibtexParser from 'bibtex-parser';
import { parse } from 'path';
import { parseString } from 'xml2js';

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
	await vscode.window.showInformationMessage(`Fetching URL: ${url}.`);
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
 * Fetches the XML from DBLP for the passed in search query.
 * @param query The search query to search DBLP for.
 * @returns Raw XML from DBLP search page.
 */
async function fetchDBLPXML(query: string): Promise<string> {
	const url = `https://dblp.org/search/publ/api?q=${encodeURIComponent(query)}&format=xml`;
	try {
		const response = await axios.get(url);
		return response.data;
	} catch (error: any) {
		await vscode.window.showErrorMessage(`Error fetching data from DBLP: ${error.message}.`);
		throw new Error(`Error fetching data from DBLP: ${error.message}`);
	}
}

/**
 * Parses the XML from DBLP and returns a list of publications.
 * @param xml The raw XML from DBLP.
 * @returns 
 */
async function parseDBLPXML(xml: string) {
	const publications: any[] = [];
	let parsedXml: any = await new Promise<any>((resolve, reject) => {
		parseString(xml, async (err, result) => {
			if (err) {
				await vscode.window.showErrorMessage(`Error parsing XML: ${err.message}.`);
				return reject(err);
			}
			resolve(result);
		});
	});

	let hits = parsedXml.result.hits;
	if (!hits || hits.length === 0 || hits[0].hit.length === 0) {
		await vscode.window.showErrorMessage(`No results found for search query.`);
		return [];
	}
	hits = hits[0].hit;
	const dataPromises = hits.map(async (hit: any) => {
		const info = hit.info[0];
		if (!info.title || !info.authors || !info.year ||
			info.title.length === 0 || info.authors.length === 0 || info.year.length === 0
		) {
			return;
		}

		const authors = info.authors[0].author.map((author: any) => author._);

		let venue = "";
		if (info.venue && info.venue.length > 0) {
			venue = info.venue[0];
		}

		let pages = "";
		if (info.pages && info.pages.length > 0) {
			pages = info.pages[0];
		}

		let doi = "";
		if (info.doi && info.doi.length > 0) {
			doi = info.doi[0];
		}
		
		return {
			title: info.title[0],
			authors: authors,
			year: info.year[0],
			booktitle: venue,
			pages: pages,
			doi: doi
		};
	});

	const data = await Promise.all(dataPromises);
	const filteredData = data.filter((entry: any) => entry !== undefined && entry !== null);

	filteredData.forEach((entry: any) => {
		const title = entry.title;
		const authors = entry.authors;
		const year = entry.year;
		const booktitle = entry.booktitle;
		const pages = entry.pages;
		const doi = entry.doi;
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

const PUBLICATION_DATABASE_KEY = "bib-search.publicationDatabase";
const PUBLICATION_DATABASE_OPTION_GOOGLE_SCHOLAR = "Google Scholar";
const PUBLICATION_DATABASE_OPTION_DBLP = "DBLP";

/**
 * Searches the publication database for the passed in search query.
 * @param searchQuery The search query to search the publication database for.
 * @returns 
 */
let searchPublicationDatabase = async (searchQuery: string): Promise<Publication[]> => {
	if (vscode.workspace.getConfiguration().get(PUBLICATION_DATABASE_KEY) === PUBLICATION_DATABASE_OPTION_GOOGLE_SCHOLAR) {
		const html = await fetchGoogleScholarHTML(searchQuery);
		const publications = await parseGoogleScholarHTML(html);
		return publications;
	} else if (vscode.workspace.getConfiguration().get(PUBLICATION_DATABASE_KEY) === PUBLICATION_DATABASE_OPTION_DBLP) {
		const html = await fetchDBLPXML(searchQuery);
		const publications = await parseDBLPXML(html);
		return publications;
	}
	return [];
}

/**
 * Returns a list of quick pick options for the user to select from, based on the pased in search results.
 * @param searchResults The search results from Google Scholar.
 * @returns 
 */
let createQuickPickOptions = (searchResults: Publication[]): vscode.QuickPickItem[] => {
	return searchResults.map((publication) => {
		return {
			label: `${publication.title}`,
			description: `${publication.booktitle} ${publication.year}`,
			detail: publication.authors.join(", "),
		};
	});
}

/**
 * Handles the search query from the user and inserts the selected BibTeX entry into the active editor.
 * @param searchQuery The raw search query from the user
 */
let searchQueryHandler = async (searchQuery: string): Promise<void> => {
	let searchResults = await searchPublicationDatabase(searchQuery);
	let quickPickOptions = createQuickPickOptions(searchResults);
	const selections: vscode.QuickPickItem[] | undefined = await vscode.window.showQuickPick(quickPickOptions, { placeHolder: "Select one or more publications. Bib entries will be inserted into the current file.", canPickMany: true });
	if (selections === undefined || selections.length === 0) {
		return;
	}

	for (let selection of selections) {
		const publication = searchResults[quickPickOptions.indexOf(selection)];
		const bibtex = `@inproceedings{${publication.authors[0].replace(" ", "_").toLowerCase()}${publication.year},
	title={${publication.title}},
	author={${publication.authors.join(" and ")}},
	year={${publication.year}},
	booktitle={${publication.booktitle}},
}\n`;
		await vscode.window.activeTextEditor?.insertSnippet(new vscode.SnippetString(bibtex));
	}
}

export function activate(context: vscode.ExtensionContext) {
	let disposable = vscode.commands.registerCommand('bib-search.search', async () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		let selectedPublicationDatabase = await vscode.workspace.getConfiguration().get(PUBLICATION_DATABASE_KEY);
		let searchQuery = await vscode.window.showInputBox({ title: `Bib Search | ${selectedPublicationDatabase}`, placeHolder: "keywords" });
		if (searchQuery !== undefined && searchQuery !== "") {
			await searchQueryHandler(searchQuery);
		}
	});

	context.subscriptions.push(disposable);
}

export function deactivate() { }

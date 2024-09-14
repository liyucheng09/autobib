// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { parseString } from 'xml2js';

interface Publication {
	title: string,
	authors: string[],
	year: string,
	booktitle: string,
	pages: string | undefined,
	doi: string | undefined,
	type: string | undefined,
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

		// Light filtering to remove empty or incomplete entries
		if (title === '' || authors.length === 0 || year === '') {
			return;
		}
		const publication: Publication = {
			title: title,
			authors: authors,
			year: year,
			booktitle: booktitle,
			pages: pages,
			doi: doi,
			type: '',
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
	if (!hits || hits.length === 0 || !hits[0] || !hits[0].hit || hits[0].hit.length === 0) {
		await vscode.window.showErrorMessage(`No results found.`);
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

		let type = "";
		if (info.type && info.type.length > 0) {
			type = info.type[0];
		}

		return {
			title: info.title[0],
			authors: authors,
			year: info.year[0],
			booktitle: venue,
			pages: pages,
			doi: doi,
			type: type,
		};
	});

	const data = await Promise.all(dataPromises);
	const filteredData = data.filter((entry: any) => entry !== undefined && entry !== null);

	const publications: Publication[] = [];
	filteredData.forEach((entry: any) => {
		const title = entry.title;
		const authors = entry.authors;
		const year = entry.year;
		const booktitle = entry.booktitle;
		const pages = entry.pages;
		const doi = entry.doi;
		const type = entry.type;
		const publication: Publication = {
			title: title,
			authors: authors,
			year: year,
			booktitle: booktitle,
			pages: pages,
			doi: doi,
			type: type,
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
 * Returns a list of quick pick options for the user to select from, based on the pased in search results. Applies some formatting to the publication data to make it more readable.
 * @param searchResults The search results from Google Scholar.
 * @returns 
 */
const createQuickPickOptions = (searchResults: Publication[]): vscode.QuickPickItem[] => {
    const transformPublication = (publication: Publication): vscode.QuickPickItem => {
        let displayTitle = publication.title;
        let displayVenue = publication.booktitle;
        if (displayTitle.length + displayVenue.length > 75) {
            displayTitle = publication.title.substring(0, 60) + "...";
            displayVenue = publication.booktitle.substring(0, 15);
        }

        const isAuthorListTooLong = publication.authors.join(", ").length > 80;
        let displayAuthors = publication.authors.map((author: string) => {
            let authorParts = author.split(" ");
            if (authorParts.length === 1) {
                return authorParts[0];
            }
            // Remove DBLP UUIDs from author names 
            let lastName = authorParts[authorParts.length - 1];
            if (lastName.match(/^\d+$/)) {
                authorParts.pop();
            }
            // Abbreviate first names if the author list is too long
            if (isAuthorListTooLong) {
                return authorParts[0][0] + ". " + authorParts.slice(1).join(" ");
            }
            return authorParts.join(" ");
        }).join(", ");

        return {
            label: displayTitle,
            description: `${displayVenue} ${publication.year}`,
            detail: displayAuthors,
        };
    };

    const categorizePublications = (publications: Publication[]): Record<string, Publication[]> => {
        const categories: Record<string, Publication[]> = {
            "Conference and Workshop Papers": [],
            "Journal Articles": [],
            "Other Articles": []
        };

        publications.forEach(pub => {
            if (pub.type?.toLowerCase().includes("conference")) {
                categories["Conference and Workshop Papers"].push(pub);
            } else if (pub.type?.toLowerCase().includes("journal")) {
                categories["Journal Articles"].push(pub);
            } else {
                categories["Other Articles"].push(pub);
            }
        });

        return categories;
    };

    const sortByYearAndTitle = (items: vscode.QuickPickItem[]): vscode.QuickPickItem[] => {
        return items.sort((a, b) => {
            const aYear = parseInt(a.description!.split(" ")[1]);
            const bYear = parseInt(b.description!.split(" ")[1]);
            if (aYear !== bYear) {
                return bYear - aYear;
            }
            return a.label.localeCompare(b.label);
        });
    };

    const categorizedItems = categorizePublications(searchResults);
    let quickPickOptions: vscode.QuickPickItem[] = [];

    ["Conference and Workshop Papers", "Journal Articles", "Other Articles"].forEach(category => {
        if (categorizedItems[category].length > 0) {
		    const publicationsTransformedToQuickPickItems = categorizedItems[category].map(transformPublication);
            quickPickOptions.push({ label: category, kind: vscode.QuickPickItemKind.Separator });
            quickPickOptions.push(...sortByYearAndTitle(publicationsTransformedToQuickPickItems));
        }
    });

    return quickPickOptions;
};

/**
 * Handles the search query from the user and inserts the selected BibTeX entry into the active editor.
 * @param searchQuery The raw search query from the user
 */
let searchQueryHandler = async (searchQuery: string): Promise<void> => {
	let searchResults = await searchPublicationDatabase(searchQuery);
	let quickPickOptions = createQuickPickOptions(searchResults);
	const selections: vscode.QuickPickItem[] | undefined = await vscode.window.showQuickPick(quickPickOptions, { placeHolder: "Select the publications you'd like snippets for.", canPickMany: true });
	if (selections === undefined || selections.length === 0) {
		return;
	}

	for (let selection of selections) {
		const originalPublication = searchResults[quickPickOptions.indexOf(selection)];
		// Remove 4 digit numbers from author names
		let filteredPublication = originalPublication;
		filteredPublication.authors.map((author: string) => {
			let authorParts = author.split(" ");
			if (authorParts.length === 1) {
				return authorParts[0];
			}
			// Remove DBLP UUIDs from author names
			let lastName = authorParts[authorParts.length - 1];
			if (lastName.match(/^\d+$/)) {
				authorParts.pop();
			}
			return authorParts.join(" ");
		});	

		const bibtex = `@inproceedings{${filteredPublication.authors[0].replace(/ /g, "_").toLowerCase()}${filteredPublication.year},
	title={${filteredPublication.title}},
	author={${filteredPublication.authors.join(" and ")}},
	year={${filteredPublication.year}},
	booktitle={${filteredPublication.booktitle}},
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

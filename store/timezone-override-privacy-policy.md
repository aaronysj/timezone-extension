# Timezone Override Privacy Policy

Applies to version 0.3.0 and later. Last updated: October 25, 2026.

## Purpose

Timezone Override changes webpage Date and default Intl timezone behavior, globally or according to domain rules you create. It does not change your operating system timezone. Each iframe follows its own URL rule. Workers and previously cached native APIs or existing Intl formatters may retain their original timezone.

## Data processed on your device

The extension reads tab URLs, frame URLs, and navigation events locally to decide which timezone rule applies. It does not record or store your browsing history. Your mode, timezone, interface language, and domain rules are stored in Chrome's local extension storage. A temporary per-tab override is held in session storage for the life of the tab and a same-origin sessionStorage marker lets the page script restore it after reload. The marker contains only the IANA timezone name and is removed when the override ends or the tab closes.

These settings and rules are not synchronized by the extension or sent to a server. You can remove rules in Settings. Uninstalling the extension removes its local extension data.

## Website access

The extension uses Chrome's scripting API and HTTP/HTTPS website access to execute bundled timezone scripts in eligible page frames. It reads the default Intl timezone to display the current tab's status. It does not use the debugger API, display Chrome's debugging banner, or automatically reload pages. It does not record page contents, passwords, cookies, network traffic, or form entries.

## Collection, sharing, and remote services

The developer does not collect, receive, sell, or share personal data through this extension. The extension has no analytics, advertising, tracking, external network requests, or remotely hosted executable code. All extension code is included in the installed package.

## Third-party websites

Websites you visit may process data under their own privacy policies. This extension changes the timezone those pages observe; it does not hide your IP address or make browsing anonymous.

## Changes and contact

This policy will be updated if the extension's data handling changes. Privacy questions can be sent through the developer contact information provided on the Chrome Web Store listing.

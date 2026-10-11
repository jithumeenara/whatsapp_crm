"use client"

/**
 * Opens the Google Picker for one spreadsheet.
 *
 * Under drive.file, picking a file here is what grants the CRM access to
 * it — the Picker is not a convenience but the permission step. That is
 * why the project number ("app id") is passed: without it Google treats
 * the pick as a different app's and the file stays closed to the CRM.
 *
 * Google's loader is fetched on first use only (apis.google.com, allowed
 * in the CSP), never on pages that do not pick anything.
 */

import { apiFetch } from "@/lib/api-fetch"

export interface PickedSheet {
  id: string
  name: string
  url: string
}

interface PickerConfig {
  accessToken: string
  apiKey: string
  appId: string | null
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Google's loader has no published types here. */
type GoogleGlobal = { gapi?: any; google?: any }

let gapiLoading: Promise<void> | null = null

function loadGapi(): Promise<void> {
  const w = window as unknown as GoogleGlobal
  if (w.gapi) return Promise.resolve()
  if (gapiLoading) return gapiLoading
  gapiLoading = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script")
    s.src = "https://apis.google.com/js/api.js"
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      gapiLoading = null
      reject(new Error("Could not load Google's file picker. Check the connection, or an ad blocker."))
    }
    document.head.appendChild(s)
  })
  return gapiLoading
}

export async function pickGoogleSpreadsheet(): Promise<PickedSheet | null> {
  const cfg = (await (await apiFetch("/api/google/picker")).json()) as PickerConfig
  await loadGapi()
  const w = window as unknown as GoogleGlobal
  await new Promise<void>((resolve) => w.gapi.load("picker", { callback: () => resolve() }))
  const g = w.google?.picker
  if (!g) throw new Error("Google's file picker did not start. Reload the page and try again.")

  return new Promise<PickedSheet | null>((resolve) => {
    const view = new g.DocsView(g.ViewId.SPREADSHEETS).setIncludeFolders(true).setMode(g.DocsViewMode.LIST)
    let builder = new g.PickerBuilder()
      .setOAuthToken(cfg.accessToken)
      .setDeveloperKey(cfg.apiKey)
      .addView(view)
      .setOrigin(window.location.origin)
      .setTitle("Choose a Google Sheet")
      .setCallback((data: any) => {
        if (data?.action === g.Action.PICKED) {
          const doc = data.docs?.[0]
          if (doc?.id) {
            resolve({ id: String(doc.id), name: String(doc.name ?? "Spreadsheet"), url: `https://docs.google.com/spreadsheets/d/${doc.id}/edit` })
            return
          }
          resolve(null)
        } else if (data?.action === g.Action.CANCEL) {
          resolve(null)
        }
      })
    if (cfg.appId) builder = builder.setAppId(cfg.appId)
    builder.build().setVisible(true)
  })
}

export interface PickedDriveFile {
  id: string
  name: string
  mimeType: string
}

/** Any one file, for attaching — or, with "form", one Google Form. Picking
 *  it is what lets the CRM open it. */
export async function pickGoogleDriveFile(kind: "any" | "form" = "any"): Promise<PickedDriveFile | null> {
  const cfg = (await (await apiFetch("/api/google/picker")).json()) as PickerConfig
  await loadGapi()
  const w = window as unknown as GoogleGlobal
  await new Promise<void>((resolve) => w.gapi.load("picker", { callback: () => resolve() }))
  const g = w.google?.picker
  if (!g) throw new Error("Google's file picker did not start. Reload the page and try again.")

  return new Promise<PickedDriveFile | null>((resolve) => {
    let builder = new g.PickerBuilder().setOAuthToken(cfg.accessToken).setDeveloperKey(cfg.apiKey)
    if (kind === "form") {
      builder = builder.addView(new g.DocsView(g.ViewId.FORMS).setMode(g.DocsViewMode.LIST)).setTitle("Choose a Google Form")
    } else {
      builder = builder
        .addView(new g.DocsView(g.ViewId.DOCS).setIncludeFolders(true).setMode(g.DocsViewMode.LIST))
        .addView(new g.DocsView(g.ViewId.DOCS).setEnableDrives(true).setIncludeFolders(true))
        .addView(new g.DocsUploadView())
        .setTitle("Attach from Google Drive")
    }
    builder = builder
      .setOrigin(window.location.origin)
      .setCallback((data: any) => {
        if (data?.action === g.Action.PICKED) {
          const doc = data.docs?.[0]
          resolve(doc?.id ? { id: String(doc.id), name: String(doc.name ?? "File"), mimeType: String(doc.mimeType ?? "") } : null)
        } else if (data?.action === g.Action.CANCEL) {
          resolve(null)
        }
      })
    if (cfg.appId) builder = builder.setAppId(cfg.appId)
    builder.build().setVisible(true)
  })
}
/* eslint-enable @typescript-eslint/no-explicit-any */

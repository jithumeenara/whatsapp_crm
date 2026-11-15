import { describe, expect, it } from "vitest"
import { pendingPathFromClick, replaceTarget } from "./report-nav-target"

// Bug: on Spending, click "Leads" in the side menu; while Leads is still
// loading the Spending page is on screen, and a period / compare / tab
// click there replaced the address with /reports/spending, cancelling
// the Leads navigation — the screen "jumped back" to Spending.

const ORIGIN = "https://crm.example.com"
const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false, target: "" }

describe("pendingPathFromClick", () => {
  it("a plain click on a Reports link is the page being opened", () => {
    expect(pendingPathFromClick({ ...plain, href: `${ORIGIN}/reports/leads?period=month` }, ORIGIN)).toBe("/reports/leads")
  })

  it("trailing slash is ignored", () => {
    expect(pendingPathFromClick({ ...plain, href: `${ORIGIN}/reports/leads/` }, ORIGIN)).toBe("/reports/leads")
  })

  it("a link that opens elsewhere does not move this tab", () => {
    for (const k of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
      expect(pendingPathFromClick({ ...plain, [k]: true, href: `${ORIGIN}/reports/leads` }, ORIGIN)).toBeNull()
    }
    expect(pendingPathFromClick({ ...plain, button: 1, href: `${ORIGIN}/reports/leads` }, ORIGIN)).toBeNull()
    expect(pendingPathFromClick({ ...plain, target: "_blank", href: `${ORIGIN}/reports/leads` }, ORIGIN)).toBeNull()
    expect(pendingPathFromClick({ ...plain, defaultPrevented: true, href: `${ORIGIN}/reports/leads` }, ORIGIN)).toBeNull()
  })

  it("links outside Reports or to another site are not tracked", () => {
    expect(pendingPathFromClick({ ...plain, href: `${ORIGIN}/inbox` }, ORIGIN)).toBeNull()
    expect(pendingPathFromClick({ ...plain, href: `https://evil.example/reports/leads` }, ORIGIN)).toBeNull()
    expect(pendingPathFromClick({ ...plain, href: "" }, ORIGIN)).toBeNull()
  })
})

describe("replaceTarget", () => {
  it("a period click while a report is still opening goes to that report", () => {
    expect(replaceTarget("/reports/leads", "/reports/spending")).toBe("/reports/leads")
  })

  it("with nothing opening it stays on the page on screen", () => {
    expect(replaceTarget(null, "/reports/spending")).toBe("/reports/spending")
    expect(replaceTarget(null, null)).toBe("/reports")
  })
})

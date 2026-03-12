// ─── STATE ───────────────────────────────────────────────────────────────────
let consultants = []
let currentSort = null
let sortDir = 1
let undoStack = []   // {type: "delete"|"add", data: row, id: string}
let undoTimer = null

// ─── LOAD ────────────────────────────────────────────────────────────────────
async function loadConsultants() {
  setMeta("Loading…")
  try {
    const res = await fetch(API_URL + "?action=getConsultants", { redirect: "follow" })
    if (!res.ok) throw new Error("HTTP " + res.status)
    consultants = await res.json()
    populateFilters()
    renderTable()
    setMeta(consultants.length + " consultants")
  } catch (err) {
    console.error(err)
    document.querySelector("#consultantTable tbody").innerHTML =
      `<tr><td colspan="99" class="empty-state" style="color:#c0392b">⚠ Could not load data — is the Apps Script deployed and set to "Anyone"?</td></tr>`
    setMeta("Connection error")
  }
}

// ─── FILTERS ─────────────────────────────────────────────────────────────────
function populateFilters() {
  const locations = [...new Set(consultants.map(c => c["Location"]).filter(Boolean))].sort()
  const expertises = [...new Set(consultants.map(c => c["Expertise"]).filter(Boolean))].sort()

  const locSel = document.getElementById("locationFilter")
  const expSel = document.getElementById("expertiseFilter")
  const locVal = locSel.value
  const expVal = expSel.value

  locSel.innerHTML = '<option value="">All Locations</option>' +
    locations.map(l => `<option value="${l}">${l}</option>`).join("")
  expSel.innerHTML = '<option value="">All Expertise</option>' +
    expertises.map(e => `<option value="${e}">${e}</option>`).join("")

  locSel.value = locVal
  expSel.value = expVal
}

function clearFilters() {
  document.getElementById("searchInput").value = ""
  document.getElementById("availabilityFilter").value = ""
  document.getElementById("locationFilter").value = ""
  document.getElementById("expertiseFilter").value = ""
  document.getElementById("rateMin").value = ""
  document.getElementById("rateMax").value = ""
  renderTable()
}

// ─── RENDER ──────────────────────────────────────────────────────────────────
const HIDDEN_COLS = ["ID", "Summary", "CV Link"]
const VISIBLE_COLS = ["Name", "Age", "Expertise", "Years Exp", "Location", "Hourly Rate (USD)", "Availability"]

function renderTable() {
  const search = document.getElementById("searchInput").value.toLowerCase()
  const avail  = document.getElementById("availabilityFilter").value
  const loc    = document.getElementById("locationFilter").value
  const exp    = document.getElementById("expertiseFilter").value
  const rMin   = parseFloat(document.getElementById("rateMin").value) || 0
  const rMax   = parseFloat(document.getElementById("rateMax").value) || Infinity

  let data = consultants.filter(c => {
    const text = Object.values(c).join(" ").toLowerCase()
    const rate = parseFloat(c["Hourly Rate (USD)"]) || 0
    return (
      text.includes(search) &&
      (!avail || c["Availability"] === avail) &&
      (!loc   || c["Location"] === loc) &&
      (!exp   || c["Expertise"] === exp) &&
      rate >= rMin && rate <= rMax
    )
  })

  const thead = document.querySelector("#consultantTable thead")
  const tbody = document.querySelector("#consultantTable tbody")
  thead.innerHTML = ""
  tbody.innerHTML = ""

  setMeta(data.length + " of " + consultants.length + " consultants")

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="99" class="empty-state">No consultants match your filters.</td></tr>`
    return
  }

  // Header
  let hRow = "<tr>"
  VISIBLE_COLS.forEach(h => {
    const arrow = currentSort === h ? (sortDir === 1 ? " ▲" : " ▼") : ""
    hRow += `<th onclick="sortBy('${h}')">${h}${arrow}</th>`
  })
  hRow += "<th>CV</th><th>Actions</th></tr>"
  thead.innerHTML = hRow

  // Rows
  data.forEach(row => {
    let tr = "<tr>"
    VISIBLE_COLS.forEach(h => {
      if (h === "Name") {
        const summary = row["Summary"] ? row["Summary"] : "No summary available."
        tr += `<td><div class="tip-wrap name-cell">${row[h] || "—"}<div class="tip">${summary}</div></div></td>`
      } else if (h === "Availability") {
        const cls = row[h] === "Available" ? "badge-available" : "badge-busy"
        tr += `<td><span class="badge ${cls}">${row[h] || "—"}</span></td>`
      } else {
        tr += `<td>${row[h] !== undefined && row[h] !== "" ? row[h] : "—"}</td>`
      }
    })
    // CV column
    const cvLink = row["CV Link"]
    tr += cvLink
      ? `<td><a class="cv-link" href="${cvLink}" target="_blank">Open ↗</a></td>`
      : `<td style="color:#b0bec5">—</td>`
    // Delete
    tr += `<td><button class="btn-delete" onclick="deleteConsultant('${row["ID"]}', '${(row["Name"] || "").replace(/'/g, "\\'")}')">Delete</button></td>`
    tr += "</tr>"
    tbody.innerHTML += tr
  })
}

function sortBy(column) {
  sortDir = currentSort === column ? sortDir * -1 : 1
  currentSort = column
  consultants.sort((a, b) => {
    const av = isNaN(a[column]) ? a[column] : +a[column]
    const bv = isNaN(b[column]) ? b[column] : +b[column]
    if (av > bv) return sortDir
    if (av < bv) return -sortDir
    return 0
  })
  renderTable()
}

// ─── ADD ─────────────────────────────────────────────────────────────────────
document.getElementById("consultantForm").onsubmit = async e => {
  e.preventDefault()
  const btn = document.getElementById("submitBtn")
  btn.disabled = true
  btn.textContent = "Saving…"

  const data = Object.fromEntries(new FormData(e.target))
  const file = document.getElementById("cvFile").files[0]

  let payload = { action: "addConsultant", data }

  if (file) {
    payload.file     = await fileToBase64(file)
    payload.fileName = file.name
    payload.mimeType = file.type
  }

  try {
    // no-cors avoids preflight; Apps Script redirects break cors-mode POST
    await fetch(API_URL, {
      method: "POST",
      mode: "no-cors",
      redirect: "follow",
      body: JSON.stringify(payload)
    })
    e.target.reset()
    document.getElementById("fileLabel").textContent = "Drop CV here or click to browse"
    document.getElementById("fileDrop").classList.remove("has-file")
    await loadConsultants()

    // Undo: we'll mark the most recently added as "last added"
    showUndo(`Added "${data["Name"]}"`, "add", null)
  } catch (err) {
    console.error("Add failed:", err)
    alert("Failed to add. Open the browser console for details.")
  }

  btn.disabled = false
  btn.textContent = "Add Consultant"
}

// ─── DELETE ──────────────────────────────────────────────────────────────────
async function deleteConsultant(id, name) {
  // Optimistic UI: remove from local array immediately
  const removed = consultants.find(c => String(c["ID"]) === String(id))
  consultants = consultants.filter(c => String(c["ID"]) !== String(id))
  renderTable()

  try {
    await fetch(API_URL + "?action=deleteConsultant&id=" + id, { redirect: "follow" })
    showUndo(`Deleted "${name}"`, "delete", removed)
  } catch (err) {
    // Rollback on failure
    if (removed) consultants.push(removed)
    renderTable()
    alert("Delete failed. Check the console.")
    console.error(err)
  }
}

// ─── UNDO ────────────────────────────────────────────────────────────────────
function showUndo(message, type, data) {
  clearTimeout(undoTimer)
  undoStack.push({ type, data })

  document.getElementById("undoMessage").textContent = message
  document.getElementById("undoToast").classList.remove("hidden")

  undoTimer = setTimeout(dismissToast, 6000)
}

async function undoAction() {
  const action = undoStack.pop()
  if (!action) return
  dismissToast()

  if (action.type === "delete" && action.data) {
    // Re-add the deleted row
    try {
      await fetch(API_URL, {
        method: "POST",
        mode: "no-cors",
        redirect: "follow",
        body: JSON.stringify({ action: "addConsultant", data: action.data, restoreId: action.data["ID"] })
      })
      await loadConsultants()
    } catch (err) {
      alert("Undo failed. Check console.")
      console.error(err)
    }
  }

  if (action.type === "add") {
    // Delete the last-added consultant (highest ID / most recent)
    const last = consultants.reduce((a, b) => (+a["ID"] > +b["ID"] ? a : b), consultants[0])
    if (last) await deleteConsultant(last["ID"], last["Name"])
  }
}

function dismissToast() {
  clearTimeout(undoTimer)
  document.getElementById("undoToast").classList.add("hidden")
}

// ─── FILE DROP UI ─────────────────────────────────────────────────────────────
const fileDrop = document.getElementById("fileDrop")
const cvFile   = document.getElementById("cvFile")
const fileLabel = document.getElementById("fileLabel")

cvFile.addEventListener("change", () => {
  if (cvFile.files[0]) {
    fileLabel.textContent = "✓ " + cvFile.files[0].name
    fileDrop.classList.add("has-file")
  }
})
fileDrop.addEventListener("dragover", e => { e.preventDefault(); fileDrop.classList.add("dragover") })
fileDrop.addEventListener("dragleave", () => fileDrop.classList.remove("dragover"))
fileDrop.addEventListener("drop", e => {
  e.preventDefault()
  fileDrop.classList.remove("dragover")
  if (e.dataTransfer.files[0]) {
    cvFile.files = e.dataTransfer.files
    fileLabel.textContent = "✓ " + e.dataTransfer.files[0].name
    fileDrop.classList.add("has-file")
  }
})

// ─── EVENT LISTENERS ─────────────────────────────────────────────────────────
["searchInput","availabilityFilter","locationFilter","expertiseFilter","rateMin","rateMax"]
  .forEach(id => document.getElementById(id).addEventListener("input", renderTable))

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function setMeta(text) { document.getElementById("headerMeta").textContent = text }

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.readAsDataURL(file)
    r.onload  = () => resolve(r.result.split(",")[1])
    r.onerror = reject
  })
}

// ─── INIT ────────────────────────────────────────────────────────────────────
loadConsultants()

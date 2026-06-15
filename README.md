# Epic Join Mapper

A minimal browser app for searching Epic Clarity metadata JSON.

## Run Locally

```powershell
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Workflow

The app shows one large searchable table:

```text
Column | Table | Joins to | Description
```

Typing in the filter fields under the headers filters rows dynamically by table, column, and description.

Each filter field shows a small clear icon when it has text. That icon clears only that filter.

Descriptions are shortened by default. Click a description cell to expand or collapse it.
Only descriptions that overflow one line are clickable. Table columns can be resized by dragging the divider in the header.

Rows with joins show a small `+` on the left. Click it to show a plain-language list of destination tables and columns.
Expanded join lists have searchable headers and resizable columns.

Use the `+` button to merge in more metadata files. If an uploaded JSON contains a table already loaded, that table is replaced with the uploaded version.

Use the theme button in the header to toggle dark/light mode. The choice is saved in browser `localStorage`.

## Expected JSON Shape

```json
{
  "extractedAt": "2026-06-15T01:08:58.178Z",
  "tables": [
    {
      "table": "PATIENT",
      "description": "Table description",
      "primaryKey": ["PAT_ID"],
      "columns": [
        {
          "name": "PAT_ID",
          "ini": "EPT",
          "item": ".1",
          "description": "Column description",
          "joins": [
            {
              "targetTable": "PATIENT_2",
              "targetColumn": "PAT_ID"
            }
          ]
        }
      ]
    }
  ],
  "foreignKeys": [
    {
      "sourceTable": "PATIENT",
      "sourceColumn": "PAT_ID",
      "targetTable": "PATIENT_2",
      "targetColumn": "PAT_ID"
    }
  ]
}
```

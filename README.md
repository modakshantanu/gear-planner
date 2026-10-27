# Gear Planner (static)

Plan purchases for thru-hiking and trail-running gear, and map out how gear is packed.
A static web page: no server, no build step, no dependencies. Data is kept in the
browser's `localStorage` as three CSV files.

## Run locally

    python3 -m http.server 8000      # then open http://127.0.0.1:8000

Opening `index.html` directly (`file://`) also works in most browsers, but some keep
`localStorage` for `file://` pages separately per file or not at all, so a local server
is the reliable option.

## Moving data between browsers

Data lives only in the browser it was entered in.

- **Export CSV** downloads `items.csv`, `containment.csv` and `configurations.csv`.
  The browser may ask once for permission to download several files.
- **Import CSV** loads one or more of those files, picked in a single dialog. Each file
  is recognised by its header row and replaces the matching data in this browser; files
  not picked are left as they are. Nothing is written if any row is invalid.
- **Clear** deletes all gear data from this browser.

The CSV format is the same as the original Python version's `data/` directory, so those
files can be imported directly.

## Data

`items.csv` holds every item, including structural containers such as pack compartments.

| column         | notes                                                      |
|----------------|------------------------------------------------------------|
| id             | lowercase letters, digits, `-`, `_`; fixed once created    |
| name           | required                                                   |
| category       | free text; the form suggests common ones (shelter, ...)    |
| weight_g       | grams, optional                                            |
| weight_type    | `base`, `worn`, `consumable`, or empty                     |
| price          | SGD, optional                                              |
| purchase_link  | optional                                                   |
| purchase_state | `owned`, `ordered`, `pending`, or empty (structural items) |
| remarks        | free text                                                  |

`containment.csv` has one `parent_id,child_id` row per "child goes inside parent".
Each child has at most one parent, and an item cannot be placed inside its own contents.

`configurations.csv` has one `config,item_id` row per item selected into a
configuration. `thru-hiking` and `trail-running` always exist; any other config name
found in the file is shown as an extra configuration.

## Views

- **Items**: add, edit (saved on change), delete, search, filter, and sort items, with
  weight and cost totals per purchase state, overall and per configuration. Tick the
  configuration columns to select items into each configuration. The **Inside** column
  sets the container an item is packed in. Deleting a container leaves its contents
  unplaced.
- **thru-hiking / trail-running** (one tab per configuration): the items selected for that
  configuration with weight and cost totals, each with a Remove button, followed by a
  searchable list of all other items, each with an Add button.
- **Pack layout**: nested-box diagram of the containment tree, with rolled-up weights.
  Each box has an **in** selector to move it to another container. A `+` after a total
  means some contained gear item has no weight yet (items with an empty purchase state
  are treated as structural and ignored). Thru-hiking items not yet placed in any
  container are listed at the bottom, each with a selector to place it.

Changes made in one tab show up in other open tabs of the same page.

## Tests

Serve the directory as above and open `tests/store.test.html`. The tests back up and
restore any data already saved in that browser.

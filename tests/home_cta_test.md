---
mode: testing
url: http://localhost:3100/
tags: [home, navigation]
assurance:
  id: T-2
---

# Home's primary call to action reaches the Shop screen

<!-- @verifies apps/fixture/README.md:13 the Home call-to-action claim -->
<!-- @covers apps/fixture/app/page.tsx, apps/fixture/app/shop/** -->

The call to action is a real `<a href="/shop">` rendered in the first server response, and the
Shop screen's count line is server-rendered too, so neither assertion waits on hydration.

## Step 1 — assert the hero call to action

Navigate to http://localhost:3100/ and assert that the hero shows a link whose name is
"Shop all six coffees".

## Step 2 — activate the link

Activate that link.

## Step 3 — assert the Shop screen was reached

Assert that the browser is now on http://localhost:3100/shop and that the Shop screen reads
"Showing 6 of 6 coffees".

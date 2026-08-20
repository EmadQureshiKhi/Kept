---
test_id: T-2
tags: [home, navigation]
covers:
  - apps/fixture/app/page.tsx
  - apps/fixture/app/shop/**
---

# Home's primary call to action reaches the Shop screen

<!-- @verifies apps/fixture/README.md:13 the Home call-to-action claim -->

1. Navigate to http://localhost:3100/ and assert that the hero shows a link whose name is
   "Shop all six coffees".
2. Activate that link.
3. Assert that the browser is now on http://localhost:3100/shop and that the Shop screen
   reads "Showing 6 of 6 coffees".

The call to action is a real `<a href="/shop">` rendered in the first server response, and
the Shop screen's count line is server-rendered too, so neither assertion waits on
hydration.

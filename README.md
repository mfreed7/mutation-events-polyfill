# mutation-events-polyfill

This is a polyfill of the Mutation Events:
  - DOMCharacterDataModified
  - DOMNodeInserted
  - DOMNodeInsertedIntoDocument
  - DOMNodeRemoved
  - DOMNodeRemovedFromDocument
  - DOMSubtreeModified

## Usage
To use this polyfill, simply load it before any calls to `addEventListener`
for Mutation Events:

  ```html
  <script src="mutation_events.js"></script>
  <div id=target></div>
  <script>
  target.addEventListener('DOMNodeInserted',() => {});
  </script>
  ```

## Implementation / Behavior
The implementation uses Mutation Observer, which should be well supported
by all evergreen browsers.

There is no standard for Mutation Events, and indeed there are some
differences between rendering engines. This polyfill is based on the
behavior of Chrome v115, which differs from Safari and Firefox in a
few ways:
  1. Firefox does not fire `DOMNodeInsertedIntoDocument` or
     `DOMNodeRemovedFromDocument`. Chrome and Safari do. This polyfill does.
  2. Firefox fires `DOMSubtreeModified` events when attributes are modified
     via `target.setAttribute()`, but not when changed directly via
     `target.attributes[0].value=foo`. Chrome and Safari do not fire events
     in either of those cases, and neither does this polyfill.
  3. Chrome and Safari fire two sets of `DOMSubtreeModified` events when
     `replaceChildren()` is called, but the second set is fired at different
     times. Firefox only fires a single set of `DOMSubtreeModified` events.
     This polyfill fires events as fired by Chrome.
  4. Generally, Firefox fires bubble listeners before capture listeners
     on the target node, which seems broken anyway. This polyfill fires
     capture before bubble.

## Timing

There are also necessary differences between the behavior of Mutation Events
and this polyfill using Mutation Observer. Primarily, the difference is in
the timing: Mutation Events are synchronous, and happen *during* the
mutation, while Mutation Observers are fired at microtask timing. One place
where this leads to observable differences is during the `DOMNodeRemoved`
event. Real `DOMNodeRemoved` events are fired before the node is removed from
its parent, while this polyfill fires those after the removal is complete.
That leads to the event needing to be fired two places - on the removed
node and *also* on the observed target, because ordinarily the event bubbles
from the former to the latter.


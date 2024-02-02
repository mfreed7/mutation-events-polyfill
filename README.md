# mutation-events Polyfill

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
The polyfill monkeypatches `addEventListener` and `removeEventListener`
and attaches a Mutation Observer whenever addEventListener is called with
a Mutation Event name. Mutation Observer is well supported by all evergreen
browsers.

There is no standard for Mutation Events, and indeed there are some
differences between rendering engines. Roughly, for a listener on `target`,
the behavior is:

<dl>
<dt><code>DOMNodeInserted</code></dt>
<dd>fired whenever a node is inserted into a new parent. This
event bubbles up through the *NEW* parent.</dd>
<dt><code>DOMNodeRemoved</code></dt>
<dd>fired whenever a node is removed from a parent. This event
bubbles up through the *OLD* parent.</dd>
<dt><code>DOMSubtreeModified</code></dt>
<dd>fired whenever any node in the SUBTREE of `target` is
modified, including: a) node inserted, b) node removed,
c) attributes added, d) attributes removed, or e) character
data modified. This event is also fired when attributes are
added or removed from `target`. It is not fired when
existing attributes are changed.</dd>
<dt><code>DOMNodeInsertedIntoDocument</code></dt>
<dd>fired whenever a node is inserted. This event
does not bubble, but is fired on every sub-node
in the inserted tree, plus the (new) parent of
the inserted tree.</dd>
<dt><code>DOMNodeRemovedFromDocument</code></dt>
<dd>fired whenever a node is removed. This event
does not bubble, but is fired on every sub-node
in the removed tree, plus the (old) parent of
the removed tree.</dd>
<dt><code>DOMCharacterDataModified</code></dt>
<dd>fired whenever a text/comment node has its data
modified.</dd>
</dl>

This polyfill is based on the behavior of Chrome v115, which differs from
Safari and Firefox in a few ways:
  1. Firefox does not fire `DOMNodeInsertedIntoDocument` or
     `DOMNodeRemovedFromDocument`. Chrome and Safari do. This polyfill does.
  2. Firefox fires `DOMSubtreeModified` events when attributes are modified
     via `target.setAttribute()`, but not when changed directly via
     `target.attributes[0].value=foo`. Chrome and Safari do not fire events
     in either of those cases, and neither does this polyfill.
  3. Chrome and Safari fire two sets of `DOMSubtreeModified` events when
     nodes are both added and removed, e.g. via a call to `replaceChildren()`.
     They differ on the timing of the second set. Firefox only fires a
     single set of `DOMSubtreeModified` events. This polyfill fires two sets
     of `DOMSubtreeModified` events.
  4. Generally, Firefox fires bubble listeners before capture listeners
     on the target node, which seems broken anyway. This polyfill fires
     capture before bubble.


## Synchronous events vs. microtask timing

There is one major differences between native Mutation Events and this polyfill
which uses Mutation Observer. Since Mutation Events are synchronous, they are
fired *during* the mutation. In contrast, Mutation Observers are fired at
microtask timing, which is *after* the mutation. One place where this leads to
observable differences is during the `DOMNodeRemoved` event. Native
`DOMNodeRemoved` events are fired before the node is removed from
its parent, while this polyfill fires those after the removal is complete.
That leads to the event needing to be fired two places - on the removed
node and *also* on the observed target, because ordinarily the event bubbles
from the former to the latter.

Additionally, the order of events is not always the same between native
Mutation Events and the events dispatched by this polyfill. But they're
close.

## Tests

The `test/test.html` file performs several DOM mutations and monitors the
events fired on the node and a parent. The test will fall back to testing the
native feature, if `MutationEvent` is supported. You can run tests directly
from this repo, [here](https://mfreed7.github.io/mutation-events-polyfill/test/test.html).

## Improvements / Bugs

If you find issues with the polyfill, feel free to file them [here](https://github.com/mfreed7/mutation-events-polyfill/issues).
Even better, if you would like to contribute to this polyfill,
I'm happy to review [pull requests](https://github.com/mfreed7/mutation-events-polyfill/pulls).
Thanks in advance!

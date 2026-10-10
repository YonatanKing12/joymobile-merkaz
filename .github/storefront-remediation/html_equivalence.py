"""Conservative comparison of Shopify HTML serialization, not a concurrency token.

Decode character references and normalize HTML tag/attribute spelling, quoting,
attribute order and void-tag spelling. Preserve all text (including whitespace),
comments, non-void structure and attribute values. Duplicate attributes fail
closed because their order can change the effective first attribute in HTML.
"""
from html.parser import HTMLParser

VOID_TAGS = frozenset({'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'})

class CanonicalHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def attributes(self, attrs):
        names = [name for name, _ in attrs]
        if len(names) != len(set(names)):
            raise ValueError('Duplicate HTML attributes cannot be normalized safely.')
        return tuple(sorted(attrs, key=lambda item: item[0]))

    def handle_starttag(self, tag, attrs):
        self.parts.append(('start', tag, self.attributes(attrs)))

    def handle_startendtag(self, tag, attrs):
        if tag in VOID_TAGS:
            self.handle_starttag(tag, attrs)
        else:
            # HTML and XML disagree on non-void self-closing tags: keep distinct.
            self.parts.append(('selfclosed', tag, self.attributes(attrs)))

    def handle_endtag(self, tag):
        if tag not in VOID_TAGS:
            self.parts.append(('end', tag))

    def handle_data(self, data):
        if data:
            if self.parts and self.parts[-1][0] == 'text':
                self.parts[-1] = ('text', self.parts[-1][1] + data)
            else:
                self.parts.append(('text', data))

    def handle_comment(self, data):
        self.parts.append(('comment', data))

    def handle_decl(self, decl):
        self.parts.append(('declaration', decl))

    def handle_pi(self, data):
        self.parts.append(('processing', data))

    def unknown_decl(self, data):
        self.parts.append(('unknown', data))

def equivalent_html(left, right):
    if not isinstance(left, str) or not isinstance(right, str):
        return False
    if left == right:
        return True
    try:
        first, second = CanonicalHTML(), CanonicalHTML()
        first.feed(left)
        first.close()
        second.feed(right)
        second.close()
        return first.parts == second.parts
    except (ValueError, AssertionError):
        return False

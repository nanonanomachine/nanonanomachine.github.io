import markdownIt from 'markdown-it';
import markdownItAnchor from 'markdown-it-anchor';

export default function (eleventyConfig) {
  // static/ lands at the site root: style.css, CNAME, anything else served as-is.
  eleventyConfig.addPassthroughCopy({ 'src/static': '.' });

  // Heading anchors: every h2-h4 gets an id and becomes its own permalink, so
  // readers can share section URLs and in-post links like #appendix-... resolve.
  eleventyConfig.setLibrary(
    'md',
    markdownIt({ html: true }).use(markdownItAnchor, {
      level: [2, 3, 4],
      // GitHub-style slugs: strip punctuation instead of percent-encoding it,
      // so "Appendix: scale" -> #appendix-scale and hand-written links match.
      slugify: (s) =>
        s
          .trim()
          .toLowerCase()
          .replace(/[^\w\s-]/g, '')
          .replace(/\s+/g, '-'),
      permalink: markdownItAnchor.permalink.headerLink({ safariReaderFix: true }),
    }),
  );

  eleventyConfig.addFilter('isoDate', (d) => new Date(d).toISOString());
  eleventyConfig.addFilter('readableDate', (d) =>
    new Date(d).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    }),
  );
  eleventyConfig.addFilter('machineDate', (d) => new Date(d).toISOString().slice(0, 10));

  // Newest first. Copy before reversing — getFilteredByGlob hands back an array
  // Eleventy still owns, and reversing it in place corrupts later reads.
  eleventyConfig.addCollection('posts', (api) =>
    [...api.getFilteredByGlob('src/posts/*.md')].reverse(),
  );

  // Tables are the point of this site, so they have to survive a phone. Markdown
  // emits a bare <table>; wrap each one in a scroll container. Crude on purpose —
  // the only HTML it sees is our own markdown output, which never nests tables.
  eleventyConfig.addTransform('wrapTables', function (content) {
    if (!(this.page.outputPath || '').endsWith('.html')) return content;
    if (!content.includes('<table>')) return content;
    return content
      .replaceAll('<table>', '<div class="table-wrap"><table>')
      .replaceAll('</table>', '</table></div>');
  });

  return {
    dir: { input: 'src', includes: '_includes', data: '_data', output: '_site' },
    markdownTemplateEngine: 'njk',
    htmlTemplateEngine: 'njk',
  };
}

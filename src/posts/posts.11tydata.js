// Shared frontmatter for every file in src/posts/.
//
// A JS data file rather than JSON because `permalink: false` has to be an
// actual boolean to stop Eleventy writing the page — the string "false" that a
// template expression would produce is truthy, and the draft would ship.
export default {
  layout: 'post.njk',
  eleventyComputed: {
    // draft: true  ->  not written, not in the index, not in the feed.
    permalink: (data) => (data.draft ? false : `/${data.page.fileSlug}/`),
    eleventyExcludeFromCollections: (data) => Boolean(data.draft),
  },
};

import { FEED_INFO_LIST } from '../resources/feed-info-list';
import { FeedCrawler } from './utils/feed-crawler';
import { FeedGenerator } from './utils/feed-generator';
import * as path from 'path';
import { FeedStorer } from './utils/feed-storer';
import { to } from 'await-to-js';
import { FeedValidator } from './utils/feed-validator';

const FEED_FETCH_CONCURRENCY = 50;
const FEED_OG_FETCH_CONCURRENCY = 20;
const FILTER_ARTICLE_DATE = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
const MAX_FEED_DESCRIPTION_LENGTH = 200;
const MAX_FEED_CONTENT_LENGTH = 500;
const STORE_FEEDS_DIR_PATH = path.join(__dirname, '../site/feeds');
const STORE_BLOG_FEEDS_DIR_PATH = path.join(__dirname, '../site/blog-feeds');

const feedCrawler = new FeedCrawler();
const feedGenerator = new FeedGenerator();
const feedValidator = new FeedValidator();
const feedStorer = new FeedStorer();

(async () => {
  // フィード取得、後処理
  const feeds = await feedCrawler.fetchFeedsAsync(FEED_INFO_LIST, FEED_FETCH_CONCURRENCY);
  const allFeedItems = feedCrawler.aggregateFeeds(feeds, FILTER_ARTICLE_DATE);

  // フィード関連データ取得
  const [errorFetchFeedData, results] = await to(
    Promise.all([feedCrawler.fetchFeedBlogOgsResultMap(feeds, FEED_OG_FETCH_CONCURRENCY)]),
  );
  if (errorFetchFeedData) {
    throw new Error('フィード関連データの取得に失敗しました');
  }
  const allFeedItemOgsResultMap = feedCrawler.fetchFeedItemOgsResultMap(allFeedItems);
  const [feedBlogOgsResultMap] = results;

  // まとめフィード作成
  const ogsResultMap = new Map([...allFeedItemOgsResultMap, ...feedBlogOgsResultMap]);
  const aggregatedFeed = feedGenerator.createFeed(
    allFeedItems,
    ogsResultMap,
    MAX_FEED_DESCRIPTION_LENGTH,
    MAX_FEED_CONTENT_LENGTH,
  );
  const outputFeedSet = feedGenerator.generateOutputFeedSet(aggregatedFeed);

  // まとめフィードのバリデーション。エラーならすぐに終了する
  const rssValidationResult = await feedValidator.validate(outputFeedSet.rss);
  const atomValidationResult = await feedValidator.validate(outputFeedSet.atom);
  if (!rssValidationResult.isValid || !atomValidationResult.isValid) {
    const rssValidationResultJson = JSON.stringify(rssValidationResult);
    const atomValidationResultJson = JSON.stringify(atomValidationResult);
    throw new Error(
      `まとめフィードのバリデーションエラーです。 rss: ${rssValidationResultJson}, atom: ${atomValidationResultJson}`,
    );
  }

  // ファイル出力、画像キャッシュ
  const [errorStoreFeed] = await to(
    Promise.all([
      feedStorer.storeFeeds(outputFeedSet, STORE_FEEDS_DIR_PATH),
      feedStorer.storeBlogFeeds(feeds, ogsResultMap, STORE_BLOG_FEEDS_DIR_PATH),
    ]),
  );
  if (errorStoreFeed) {
    throw new Error('ファイル出力に失敗しました', {
      cause: errorStoreFeed,
    });
  }
})();

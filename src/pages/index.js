import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';

import Heading from '@theme/Heading';
import styles from './index.module.css';

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          ODPM 帮助中心
        </Heading>
        <p className="hero__subtitle">ODPM 产品文档、操作指引和常见问题。当前为内部 UAT 测试环境。</p>
        <div className={styles.buttons}>
          <Link
  className="button button--secondary button--lg"
  to="/docs/intro">
  浏览文档
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function Home() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={siteConfig.title}
      description="ODPM 帮助中心 - 产品文档、操作指引和常见问题">
      <HomepageHeader />
    </Layout>
  );
}

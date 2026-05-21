import type {ReactNode} from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  Svg: React.ComponentType<React.ComponentProps<'svg'>>;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: '易于使用',
    Svg: require('@site/static/img/undraw_docusaurus_mountain.svg').default,
    description: (
      <>
        文档站点基于 Docusaurus 构建，设计初衷是让您能够快速上手，
        轻松搭建并运行您的文档网站。
      </>
    ),
  },
  {
    title: '专注于内容',
    Svg: require('@site/static/img/undraw_docusaurus_tree.svg').default,
    description: (
      <>
        让您专注于编写高质量的文档，繁琐的配置交给我们。
        只需将您的 Markdown 文件放入 <code>docs</code> 目录即可。
      </>
    ),
  },
  {
    title: '智能 AI 助手',
    Svg: require('@site/static/img/undraw_docusaurus_react.svg').default,
    description: (
      <>
        内置强大的大模型文档 AI 助手，在您阅读和编写文档时提供智能化问答、
        文档检索和技术支持，大幅提升您的工作效率。
      </>
    ),
  },
];

function Feature({title, Svg, description}: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center">
        <Svg className={styles.featureSvg} role="img" />
      </div>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}

import type { Locale } from "@ladestack/i18n";

export type ErrorBoundaryScope =
  | "app"
  | "workspace"
  | "editor"
  | "preview"
  | "overview"
  | "dashboard"
  | "agent";

export interface ErrorBoundaryStrings {
  heading: string;
  body: string;
  compactBody: string;
  retry: string;
  reload: string;
  backHome: string;
  details: string;
  copyDetails: string;
  copied: string;
  scopes: Record<ErrorBoundaryScope, string>;
}

export const errorBoundaryStrings: Record<Locale, ErrorBoundaryStrings> = {
  en: {
    heading: "Something went wrong in this view",
    body: "An unexpected interface error interrupted this section. Your saved project files remain in this browser's local storage.",
    compactBody: "This panel hit an unexpected error. Your saved project files are safe.",
    retry: "Try again",
    reload: "Reload page",
    backHome: "Back to start",
    details: "Technical details",
    copyDetails: "Copy details",
    copied: "Copied",
    scopes: {
      app: "Application",
      workspace: "Workspace",
      editor: "Code editor",
      preview: "Live preview",
      overview: "Project overview",
      dashboard: "Project dashboard",
      agent: "Agent panel",
    },
  },
  ru: {
    heading: "В этом разделе произошла ошибка",
    body: "Неожиданная ошибка интерфейса прервала работу этой области. Сохранённые файлы проекта остались в локальном хранилище браузера.",
    compactBody: "В этой панели произошла ошибка. Сохранённые файлы проекта не пострадали.",
    retry: "Попробовать снова",
    reload: "Перезагрузить страницу",
    backHome: "В начало",
    details: "Технические подробности",
    copyDetails: "Копировать подробности",
    copied: "Скопировано",
    scopes: {
      app: "Приложение",
      workspace: "Рабочая область",
      editor: "Редактор кода",
      preview: "Предпросмотр",
      overview: "Обзор проекта",
      dashboard: "Панель проекта",
      agent: "Панель агента",
    },
  },
  ja: {
    heading: "この画面でエラーが発生しました",
    body: "予期しない UI エラーによりこの領域の表示が中断されました。保存済みのプロジェクトファイルはこのブラウザに安全に残っています。",
    compactBody: "このパネルでエラーが発生しました。保存済みファイルは無事です。",
    retry: "再試行",
    reload: "ページを再読み込み",
    backHome: "最初に戻る",
    details: "技術的な詳細",
    copyDetails: "詳細をコピー",
    copied: "コピーしました",
    scopes: {
      app: "アプリケーション",
      workspace: "ワークスペース",
      editor: "コードエディタ",
      preview: "ライブプレビュー",
      overview: "プロジェクト概要",
      dashboard: "プロジェクト指標",
      agent: "エージェントパネル",
    },
  },
  ko: {
    heading: "이 화면에서 오류가 발생했습니다",
    body: "예기치 않은 인터페이스 오류로 이 영역이 중단되었습니다. 저장된 프로젝트 파일은 이 브라우저의 로컬 저장소에 안전하게 보관되어 있습니다.",
    compactBody: "이 패널에서 오류가 발생했습니다. 저장된 프로젝트 파일은 안전합니다.",
    retry: "다시 시도",
    reload: "페이지 새로고침",
    backHome: "처음으로",
    details: "기술 세부 정보",
    copyDetails: "세부 정보 복사",
    copied: "복사됨",
    scopes: {
      app: "애플리케이션",
      workspace: "작업 공간",
      editor: "코드 편집기",
      preview: "실시간 미리보기",
      overview: "프로젝트 개요",
      dashboard: "프로젝트 대시보드",
      agent: "에이전트 패널",
    },
  },
  zh: {
    heading: "此视图出现错误",
    body: "意外的界面错误中断了此区域的渲染。你已保存的项目文件仍安全地保留在此浏览器的本地存储中。",
    compactBody: "此面板遇到意外错误。已保存的项目文件未受影响。",
    retry: "重试",
    reload: "重新加载页面",
    backHome: "返回开始",
    details: "技术详情",
    copyDetails: "复制详情",
    copied: "已复制",
    scopes: {
      app: "应用程序",
      workspace: "工作区",
      editor: "代码编辑器",
      preview: "实时预览",
      overview: "项目概览",
      dashboard: "项目仪表盘",
      agent: "智能体面板",
    },
  },
  tr: {
    heading: "Bu görünümde bir sorun oluştu",
    body: "Beklenmeyen bir arayüz hatası bu bölümü durdurdu. Kayıtlı proje dosyalarınız bu tarayıcının yerel depolamasında güvende kalmaya devam ediyor.",
    compactBody: "Bu panelde beklenmeyen bir hata oluştu. Kayıtlı dosyalarınız güvende.",
    retry: "Tekrar dene",
    reload: "Sayfayı yenile",
    backHome: "Başa dön",
    details: "Teknik ayrıntılar",
    copyDetails: "Ayrıntıları kopyala",
    copied: "Kopyalandı",
    scopes: {
      app: "Uygulama",
      workspace: "Çalışma alanı",
      editor: "Kod düzenleyici",
      preview: "Canlı önizleme",
      overview: "Proje özeti",
      dashboard: "Proje panosu",
      agent: "Ajan paneli",
    },
  },
  fr: {
    heading: "Une erreur est survenue dans cette vue",
    body: "Une erreur d'interface inattendue a interrompu cette section. Vos fichiers enregistrés restent intacts dans le stockage local de ce navigateur.",
    compactBody: "Ce panneau a rencontré une erreur inattendue. Vos fichiers enregistrés sont intacts.",
    retry: "Réessayer",
    reload: "Recharger la page",
    backHome: "Retour au début",
    details: "Détails techniques",
    copyDetails: "Copier les détails",
    copied: "Copié",
    scopes: {
      app: "Application",
      workspace: "Espace de travail",
      editor: "Éditeur de code",
      preview: "Aperçu en direct",
      overview: "Aperçu du projet",
      dashboard: "Tableau du projet",
      agent: "Panneau de l'agent",
    },
  },
  pt: {
    heading: "Algo deu errado nesta visualização",
    body: "Um erro inesperado de interface interrompeu esta seção. Seus arquivos salvos continuam seguros no armazenamento local deste navegador.",
    compactBody: "Este painel encontrou um erro inesperado. Seus arquivos salvos continuam seguros.",
    retry: "Tentar novamente",
    reload: "Recarregar página",
    backHome: "Voltar ao início",
    details: "Detalhes técnicos",
    copyDetails: "Copiar detalhes",
    copied: "Copiado",
    scopes: {
      app: "Aplicativo",
      workspace: "Área de trabalho",
      editor: "Editor de código",
      preview: "Pré-visualização ao vivo",
      overview: "Visão geral do projeto",
      dashboard: "Painel do projeto",
      agent: "Painel do agente",
    },
  },
};

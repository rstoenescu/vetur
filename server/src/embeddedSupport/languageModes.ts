import {
  CompletionItem,
  Location,
  SignatureHelp,
  Definition,
  TextEdit,
  TextDocument,
  Diagnostic,
  DocumentLink,
  Range,
  Hover,
  DocumentHighlight,
  CompletionList,
  Position,
  FormattingOptions,
  SymbolInformation,
  CodeActionContext,
  ColorInformation,
  Color,
  ColorPresentation,
  Command
} from 'vscode-languageserver-types';

import { getLanguageModelCache, LanguageModelCache } from './languageModelCache';
import { getVueDocumentRegions, VueDocumentRegions, LanguageId, LanguageRange } from './embeddedSupport';
import { getVueMode } from '../modes/vue';
import { getCSSMode, getSCSSMode, getLESSMode, getPostCSSMode } from '../modes/style';
import { getJavascriptMode } from '../modes/script/javascript';
import { VueHTMLMode } from '../modes/template';
import { getStylusMode } from '../modes/style/stylus';
import { DocumentContext, RefactorAction } from '../types';
import { VueInfoService } from '../services/vueInfoService';
import { DependencyService, State } from '../services/dependencyService';
import { nullMode } from '../modes/nullMode';
import { getServiceHost, IServiceHost } from '../services/typescriptService/serviceHost';

export interface VLSServices {
  infoService?: VueInfoService;
  dependencyService?: DependencyService;
}

export interface LanguageMode {
  getId(): string;
  configure?(options: any): void;
  updateFileInfo?(doc: TextDocument): void;

  doValidation?(document: TextDocument): Diagnostic[];
  getCodeActions?(
    document: TextDocument,
    range: Range,
    formatParams: FormattingOptions,
    context: CodeActionContext
  ): Command[];
  getRefactorEdits?(doc: TextDocument, args: RefactorAction): Command;
  doComplete?(document: TextDocument, position: Position): CompletionList;
  doResolve?(document: TextDocument, item: CompletionItem): CompletionItem;
  doHover?(document: TextDocument, position: Position): Hover;
  doSignatureHelp?(document: TextDocument, position: Position): SignatureHelp | null;
  findDocumentHighlight?(document: TextDocument, position: Position): DocumentHighlight[];
  findDocumentSymbols?(document: TextDocument): SymbolInformation[];
  findDocumentLinks?(document: TextDocument, documentContext: DocumentContext): DocumentLink[];
  findDefinition?(document: TextDocument, position: Position): Definition;
  findReferences?(document: TextDocument, position: Position): Location[];
  format?(document: TextDocument, range: Range, options: FormattingOptions): TextEdit[];
  findDocumentColors?(document: TextDocument): ColorInformation[];
  getColorPresentations?(document: TextDocument, color: Color, range: Range): ColorPresentation[];

  onDocumentChanged?(filePath: string): void;
  onDocumentRemoved(document: TextDocument): void;
  dispose(): void;
}

export interface LanguageModeRange extends LanguageRange {
  mode: LanguageMode;
}

export class LanguageModes {
  private modes: { [k in LanguageId]: LanguageMode } = {
    vue: nullMode,
    pug: nullMode,
    'vue-html': nullMode,
    css: nullMode,
    postcss: nullMode,
    scss: nullMode,
    less: nullMode,
    stylus: nullMode,
    javascript: nullMode,
    typescript: nullMode,
    tsx: nullMode
  };

  private documentRegions: LanguageModelCache<VueDocumentRegions>;
  private modelCaches: LanguageModelCache<any>[];
  private serviceHost: IServiceHost;

  constructor() {
    this.documentRegions = getLanguageModelCache<VueDocumentRegions>(10, 60, document =>
      getVueDocumentRegions(document)
    );

    this.modelCaches = [];
    this.modelCaches.push(this.documentRegions);
  }

  async init(workspacePath: string, services: VLSServices) {
    let tsModule = await import('typescript');
    if (services.dependencyService) {
      const ts = services.dependencyService.getDependency('typescript');
      if (ts && ts.state === State.Loaded) {
        tsModule = ts.module;
      }
    }

    const jsDocuments = getLanguageModelCache(10, 60, document => {
      const vueDocument = this.documentRegions.get(document);
      return vueDocument.getSingleTypeDocument('script');
    });
    this.serviceHost = getServiceHost(tsModule, workspacePath, jsDocuments);

    const vueHtmlMode = new VueHTMLMode(
      tsModule,
      this.serviceHost,
      this.documentRegions,
      workspacePath,
      services.infoService
    );
    const jsMode = await getJavascriptMode(
      this.serviceHost,
      this.documentRegions,
      workspacePath,
      services.infoService,
      services.dependencyService
    );

    this.modes['vue'] = getVueMode();
    this.modes['vue-html'] = vueHtmlMode;
    this.modes['css'] = getCSSMode(this.documentRegions);
    this.modes['postcss'] = getPostCSSMode(this.documentRegions);
    this.modes['scss'] = getSCSSMode(this.documentRegions);
    this.modes['less'] = getLESSMode(this.documentRegions);
    this.modes['stylus'] = getStylusMode(this.documentRegions);
    this.modes['javascript'] = jsMode;
    this.modes['typescript'] = jsMode;
    this.modes['tsx'] = jsMode;
  }

  getModeAtPosition(document: TextDocument, position: Position): LanguageMode | undefined {
    const languageId = this.documentRegions.get(document).getLanguageAtPosition(position);
    return this.modes[languageId];
  }

  getAllLanguageModeRangesInDocument(document: TextDocument): LanguageModeRange[] {
    const result: LanguageModeRange[] = [];

    const documentRegions = this.documentRegions.get(document);

    documentRegions.getAllLanguageRanges().forEach(lr => {
      const mode = this.modes[lr.languageId];
      if (mode) {
        result.push({
          mode,
          ...lr
        });
      }
    });

    return result;
  }

  getAllModes(): LanguageMode[] {
    const result = [];
    for (const languageId in this.modes) {
      const mode = this.modes[<LanguageId>languageId];
      if (mode) {
        result.push(mode);
      }
    }
    return result;
  }

  getMode(languageId: LanguageId): LanguageMode | undefined {
    return this.modes[languageId];
  }

  onDocumentRemoved(document: TextDocument) {
    this.modelCaches.forEach(mc => mc.onDocumentRemoved(document));
    for (const mode in this.modes) {
      this.modes[<LanguageId>mode].onDocumentRemoved(document);
    }
  }

  dispose(): void {
    this.modelCaches.forEach(mc => mc.dispose());
    this.modelCaches = [];
    for (const mode in this.modes) {
      this.modes[<LanguageId>mode].dispose();
    }
    delete this.modes;
    this.serviceHost.dispose();
  }
}

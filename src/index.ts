import * as chalk from "chalk";
import { basename as fileBasename, normalize as fileNormalize } from "path";
import { format, types } from "util";
import {
  IErrorObject,
  ILogLevel,
  ILogObject,
  ISettings,
  ISettingsParam,
  IStackFrame,
  IStd,
  ITransportLogger,
  ITransportProvider,
  TLogLevel,
} from "./interfaces";
import { LoggerHelper } from "./LoggerHelper";
export { ITransportLogger };

export class Logger {
  private readonly _logLevels: ILogLevel = {
    0: "silly",
    1: "trace",
    2: "debug",
    3: "info",
    4: "warn",
    5: "error",
    6: "fatal",
  };
  private _ignoreStackLevels: number = 3;
  private _attachedTransports: ITransportProvider[] = [];
  private readonly _minLevelToStdErr: number = 4;

  // Settings
  public readonly settings: ISettings;

  public constructor(settings?: ISettingsParam) {
    this.settings = {
      instanceId: settings?.instanceId,
      name: settings?.name ?? "",
      minLevel: settings?.minLevel ?? 0,
      exposeStack: settings?.exposeStack ?? false,
      suppressLogging: settings?.suppressLogging ?? false,
      doOverwriteConsole: settings?.doOverwriteConsole ?? false,
      logAsJson: settings?.logAsJson ?? false,
      logLevelsColors: settings?.logLevelsColors ?? {
        0: "#B0B0B0",
        1: "#FFFFFF",
        2: "#63C462",
        3: "#2020C0",
        4: "#CE8743",
        5: "#CD444C",
        6: "#FF0000",
      },
      jsonHighlightColors: {
        number: "#FF6188",
        key: "#A9DC76",
        string: "#FFD866",
        boolean: "#FC9867",
        null: "#AB9DF2",
      },
      stdOut: settings?.stdOut ?? process.stdout,
      stdErr: settings?.stdErr ?? process.stderr,
    };

    LoggerHelper.errorToJsonHelper();
    if (this.settings.doOverwriteConsole) {
      LoggerHelper.overwriteConsole(this, this._handleLog);
    }
  }

  public attachTransport(
    logger: ITransportLogger<(...args: unknown[]) => void>,
    minLevel: TLogLevel = 0
  ): void {
    this._attachedTransports.push({
      minLevel,
      logger,
    });
  }

  public silly(...args: unknown[]): ILogObject {
    return this._handleLog.apply(this, [0, args]);
  }

  public trace(...args: unknown[]): ILogObject {
    return this._handleLog.apply(this, [1, args, true]);
  }

  public debug(...args: unknown[]): ILogObject {
    return this._handleLog.apply(this, [2, args]);
  }

  public info(...args: unknown[]): ILogObject {
    return this._handleLog.apply(this, [3, args]);
  }

  public warn(...args: unknown[]): ILogObject {
    return this._handleLog.apply(this, [4, args]);
  }

  public error(...args: unknown[]): ILogObject {
    return this._handleLog.apply(this, [5, args]);
  }

  public fatal(...args: unknown[]): ILogObject {
    return this._handleLog.apply(this, [6, args]);
  }

  private _handleLog(
    logLevel: TLogLevel,
    logArguments: unknown[],
    doExposeStack: boolean = this.settings.exposeStack
  ): ILogObject {
    const logObject: ILogObject = this._buildLogObject(
      logLevel,
      logArguments,
      doExposeStack
    );

    if (!this.settings.suppressLogging && logLevel >= this.settings.minLevel) {
      if (!this.settings.logAsJson) {
        this._printPrettyLog(logObject);
      } else {
        this._printJsonLog(logObject);
      }
    }

    this._attachedTransports.forEach((transport: ITransportProvider) => {
      if (logLevel >= transport.minLevel) {
        transport[this._logLevels[logLevel]](logObject);
      }
    });

    return logObject;
  }

  private _buildLogObject(
    logLevel: TLogLevel,
    logArguments: unknown[],
    doExposeStack: boolean = true
  ): ILogObject {
    const callSites: NodeJS.CallSite[] = LoggerHelper.getCallSites();
    const relevantCallSites: NodeJS.CallSite[] = callSites.splice(
      this._ignoreStackLevels
    );
    const stackFrame: NodeJS.CallSite = LoggerHelper.wrapCallSiteOrIgnore(
      relevantCallSites[0]
    );
    const stackFrameObject: IStackFrame = Logger._toStackFrameObject(
      stackFrame
    );

    const logObject: ILogObject = {
      loggerName: this.settings.name ?? "",
      date: new Date(),
      logLevel: logLevel,
      logLevelName: this._logLevels[logLevel],
      filePath: stackFrameObject.filePath,
      fullFilePath: stackFrameObject.fullFilePath,
      fileName: stackFrameObject.fileName,
      lineNumber: stackFrameObject.lineNumber,
      columnNumber: stackFrameObject.columnNumber,
      isConstructor: stackFrameObject.isConstructor,
      functionName: stackFrameObject.functionName,
      typeName: stackFrameObject.typeName,
      methodName: stackFrameObject.methodName,
      argumentsArray: [],
    };

    logArguments.forEach((arg: unknown) => {
      if (typeof arg === "object" && !types.isNativeError(arg)) {
        logObject.argumentsArray.push(JSON.parse(JSON.stringify(arg)));
      } else if (typeof arg === "object" && types.isNativeError(arg)) {
        const errorStack: NodeJS.CallSite[] = LoggerHelper.getCallSites(arg);
        const errorObject: IErrorObject = JSON.parse(JSON.stringify(arg));
        errorObject.name = errorObject.name ?? "Error";
        errorObject.isError = true;
        errorObject.stack = this._toStackObjectArray(errorStack);
        logObject.argumentsArray.push(errorObject);
      } else {
        logObject.argumentsArray.push(format(arg));
      }
    });

    if (doExposeStack) {
      logObject.stack = this._toStackObjectArray(relevantCallSites);
    }

    return logObject;
  }

  private _toStackObjectArray(jsStack: NodeJS.CallSite[]): IStackFrame[] {
    const prettyStack: IStackFrame[] = Object.values(jsStack).reduce(
      (iPrettyStack: IStackFrame[], stackFrame: NodeJS.CallSite) => {
        iPrettyStack.push(
          Logger._toStackFrameObject(
            LoggerHelper.wrapCallSiteOrIgnore(stackFrame)
          )
        );
        return iPrettyStack;
      },
      []
    );
    return prettyStack;
  }

  private static _toStackFrameObject(stackFrame: NodeJS.CallSite): IStackFrame {
    const filePath: string | null = stackFrame.getFileName();
    return {
      filePath: LoggerHelper.cleanUpFilePath(filePath) ?? "",
      fullFilePath: filePath ?? "",
      fileName: fileBasename(stackFrame.getFileName() ?? ""),
      lineNumber: stackFrame.getLineNumber(),
      columnNumber: stackFrame.getColumnNumber(),
      isConstructor: stackFrame.isConstructor(),
      functionName: stackFrame.getFunctionName(),
      typeName: stackFrame.getTypeName(),
      methodName: stackFrame.getMethodName(),
    };
  }

  private _printPrettyLog(logObject: ILogObject): void {
    const std: IStd =
      logObject.logLevel < this._minLevelToStdErr
        ? this.settings.stdOut
        : this.settings.stdErr;
    const nowStr: string = logObject.date
      .toISOString()
      .replace("T", " ")
      .replace("Z", "");
    const hexColor: string = this.settings.logLevelsColors[logObject.logLevel];

    std.write(chalk`{grey ${nowStr}}\t`);
    std.write(
      chalk.hex(hexColor).bold(` ${logObject.logLevelName.toUpperCase()}\t`)
    );

    const functionName: string = logObject.isConstructor
      ? `${logObject.typeName}.constructor`
      : logObject.methodName != null
      ? `${logObject.typeName}.${logObject.methodName}`
      : `${logObject.functionName}`;

    const optionalInstanceId: string =
      this.settings.instanceId != null ? `@${this.settings.instanceId}` : "";

    std.write(
      chalk.gray(
        `[${logObject.loggerName}${optionalInstanceId} ${logObject.filePath}:${logObject.lineNumber} ${functionName}]\t`
      )
    );

    logObject.argumentsArray.forEach((argument: unknown | IErrorObject) => {
      const errorArgument: IErrorObject = argument as IErrorObject;
      if (typeof argument === "object" && !errorArgument.isError) {
        std.write(
          "\n" +
            LoggerHelper.colorizeJson(
              argument as object,
              chalk,
              this.settings.jsonHighlightColors
            ) +
            " "
        );
      } else if (typeof argument === "object" && errorArgument.isError) {
        std.write(
          format(
            chalk`\n{whiteBright.bgRed.bold ${
              errorArgument.name
            }}{grey :} ${format(errorArgument.message)}\n`
          )
        );

        this._printPrettyStack(std, errorArgument.stack);
      } else {
        std.write(format(argument + " "));
      }
    });
    std.write("\n");

    if (logObject.stack != null) {
      std.write(chalk`{underline.bold log stack:\n}`);
      this._printPrettyStack(std, logObject.stack);
    }
  }

  private _printPrettyStack(std: IStd, stackObjectArray: IStackFrame[]): void {
    std.write("\n");
    Object.values(stackObjectArray).forEach((stackObject: IStackFrame) => {
      std.write(
        chalk`    {grey •} {yellowBright ${
          stackObject.fileName
        }}{grey :}{yellow ${stackObject.lineNumber}} {white ${
          stackObject.functionName ?? "<anonumous>"
        }}`
      );
      std.write("\n    ");
      std.write(
        fileNormalize(
          chalk`{grey ${stackObject.fullFilePath}:${stackObject.lineNumber}:${stackObject.columnNumber}}`
        )
      );
      std.write("\n\n");
    });
  }

  private _printJsonLog(logObject: ILogObject): void {
    const std: IStd =
      logObject.logLevel < this._minLevelToStdErr
        ? this.settings.stdOut
        : this.settings.stdErr;
    std.write(
      LoggerHelper.colorizeJson(
        JSON.stringify(logObject),
        chalk,
        this.settings.jsonHighlightColors
      ) + "\n"
    );
  }
}

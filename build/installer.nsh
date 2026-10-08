!macro customInstall
  ${If} $LANGUAGE == 1049
    StrCpy $0 "ru"
  ${Else}
    StrCpy $0 "en"
  ${EndIf}
  FileOpen $1 "$INSTDIR\install-language" w
  FileWrite $1 $0
  FileClose $1
!macroend

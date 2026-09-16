package main

import (
	"embed"
	"fmt"
	"log/slog"
	"runtime/debug"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"

	"wisp/internal/errlog"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Catches a panic anywhere synchronously reachable from main (wails.Run and the
	// OnStartup/OnShutdown/OnBeforeClose callbacks it invokes) so it lands in the local
	// log (internal/errlog) instead of just crashing silently once there is no terminal
	// attached (a released .deb/AppImage has none). Does not cover panics in goroutines
	// spawned elsewhere — recover only stops unwinding on the goroutine that panicked.
	defer func() {
		if r := recover(); r != nil {
			errlog.Error("go-panic", fmt.Sprint(r), slog.String("stack", string(debug.Stack())))
			// Re-panic after logging: recovering here would leave the app in an
			// unknown state (wails.Run's own goroutines already unwound) — the
			// point is only to make sure the panic reaches disk before the
			// process exits, not to keep running past it.
			panic(r)
		}
	}()

	// Create an instance of the app structure
	app := NewApp()

	// Create application with options
	err := wails.Run(&options.App{
		Title:  "wisp",
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		OnBeforeClose:    app.beforeClose,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
